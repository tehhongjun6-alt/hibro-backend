// Load private configuration values before creating database and Supabase connections
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { supabase } = require("./supabaseClient");

// Create the Express API application
const app = express();

// Allow frontend requests and convert incoming JSON into req.body
app.use(cors());
app.use(express.json());
// Create a new account through Supabase Auth
app.post("/auth/signup", async (req, res) => {
  const { email, password } = req.body;

  // Stop the request when required account details are missing
  if (!email || !password) {
    return res.status(400).json({
      error: "Email and password are required",
    });
  }

  // Let Supabase create the account and securely hash the password
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  // Return a clear client error when Supabase rejects the signup
  if (error) {
    if (error.message.includes("already registered")) {
      return res.status(409).json({
        error: "Email already in use",
      });
    }

    return res.status(400).json({
      error: error.message,
    });
  }

  res.status(201).json({
    user: data.user,
  });
});
// Log in through Supabase Auth and receive an authentication session
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  // Ask Supabase to verify the submitted email and password
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return res.status(401).json({
      error: error.message,
    });
  }

  // The session contains the access token required by protected routes
  res.json({
    session: data.session,
  });
});
// Verify the access token before allowing a protected request to continue
async function verifySupabaseSession(req, res, next) {
  const auth = req.headers.authorization;

  // Reject requests that do not include an Authorization header
  if (!auth) {
    return res.status(401).json({
      error: "Access token is required",
    });
  }

  // Require exactly "Bearer ACCESS_TOKEN" before asking Supabase to verify it
  const parts = auth.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
    return res.status(401).json({
      error: "Valid Bearer token is required",
    });
  }
  const token = parts[1];

  // Ask Supabase Auth to verify the token and return its user
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({
      error: "Invalid or expired access token",
    });
  }

  // Store the verified user so the next route can use their identity
  req.user = {
    userId: data.user.id,
    email: data.user.email,
  };

  next();
}

// Allow anonymous readers while verifying any token that was supplied
function optionalSupabaseSession(req, res, next) {
  if (!req.headers.authorization) {
    return next();
  }

  return verifySupabaseSession(req, res, next);
}

// Return the identity belonging to a valid access token
app.get("/whoami", verifySupabaseSession, (req, res) => {
  res.json(req.user);
});
// Create a pending friend request from the logged-in user to another user
app.post("/friend", verifySupabaseSession, async (req, res) => {
  const { friendId } = req.body;
  const requesterId = req.user.userId;

  // Require a receiver and prevent users from adding themselves
  if (!friendId) {
    return res.status(400).json({
      error: "Friend ID is required",
    });
  }

  if (friendId === requesterId) {
    return res.status(400).json({
      error: "You cannot add yourself as a friend",
    });
  }

  try {
    // Confirm that the receiver exists in the public users table
    const userResult = await pool.query(
      "SELECT id FROM users WHERE id = $1",
      [friendId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    // Prevent duplicate requests in either direction
    const existingFriendship = await pool.query(
      `SELECT * FROM friendships
             WHERE (requester_id = $1 AND receiver_id = $2)
                OR (requester_id = $2 AND receiver_id = $1)`,
      [requesterId, friendId]
    );

    if (existingFriendship.rows.length > 0) {
      return res.status(409).json({
        error: "Friendship already exists",
      });
    }

    // Store the new relationship as pending until the receiver accepts it
    const result = await pool.query(
      `INSERT INTO friendships (requester_id, receiver_id, status)
             VALUES ($1, $2, 'pending')
             RETURNING *`,
      [requesterId, friendId]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Something went wrong",
    });
  }
});
// Allow only the receiver to accept a pending friend request
app.patch(
  "/friend/:id/accept",
  verifySupabaseSession,
  async (req, res) => {
    const { id } = req.params;
    const receiverId = req.user.userId;

    try {
      // Update only the pending request belonging to this receiver
      const result = await pool.query(
        `UPDATE friendships
         SET status = 'accepted'
         WHERE id = $1
           AND receiver_id = $2
           AND status = 'pending'
         RETURNING *`,
        [id, receiverId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "Pending friend request not found",
        });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: "Something went wrong",
      });
    }
  }
);

// Create a reusable connection pool for running PostgreSQL queries
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});
// Return other users so the Friends page can display them
app.get("/users", verifySupabaseSession, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username FROM users WHERE id <> $1 ORDER BY username",
      [req.user.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("GET /users failed:", error);
    res.status(500).json({ error: "Unable to load users" });
  }
});

// Show public posts to everyone and friends-only posts to their author and accepted friends
app.get("/posts", optionalSupabaseSession, async (req, res) => {
  const userId = req.user?.userId || null;

  try {
    const result = await pool.query(
      `SELECT posts.*, users.username AS author
       FROM posts
       JOIN users ON users.id = posts.author_id
       WHERE posts.visibility = 'public'
          OR (
            $1::uuid IS NOT NULL
            AND posts.visibility = 'friends-only'
            AND (
              posts.author_id = $1::uuid
              OR EXISTS (
                SELECT 1
                FROM friendships
                WHERE friendships.status = 'accepted'
                  AND (
                    (friendships.requester_id = $1::uuid
                     AND friendships.receiver_id = posts.author_id)
                    OR
                    (friendships.receiver_id = $1::uuid
                     AND friendships.requester_id = posts.author_id)
                  )
              )
            )
          )
       ORDER BY posts.created_at DESC, posts.id DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Create a post for the user identified by the verified access token
app.post("/posts", verifySupabaseSession, async (req, res) => {
  const { content, visibility } = req.body;
  const authorId = req.user.userId;

  // Require post content and one of the two supported visibility values
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "Content is required" });
  }

  if (!["public", "friends-only"].includes(visibility)) {
    return res.status(400).json({
      error: "Visibility must be public or friends-only",
    });
  }

  try {
    // Save the post with the authenticated user as its author
    const result = await pool.query(
      `INSERT INTO posts (content, author_id, visibility)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [content.trim(), authorId, visibility]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});


// Return a simple response to confirm that the API server is running
app.get("/", (req, res) => {
  res.json({
    message: "HiBro API is running",
  });
});

// Run a basic SQL query to confirm that the database connection works
app.get("/db-check", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Database connection failed",
    });
  }
});

// Use the configured port locally and allow the hosting platform to provide another port
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`HiBro API is listening on port ${PORT}`);
});
