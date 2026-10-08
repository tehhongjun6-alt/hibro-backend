# HiBro API

HiBro is a social media API built with Express, PostgreSQL, and Supabase Auth. People can create accounts, log in, send and accept friend requests, and share public or friends-only posts.

## Features
- Supabase Auth handles signup, login, and access tokens.
- PostgreSQL stores user profiles, friendships, and posts.
- Protected routes verify the `Authorization: Bearer <access_token>` header.
- Everyone can read public posts. An authenticated user can also read their own friends-only posts and friends-only posts from accepted friends.

## Run locally

1. Install dependencies with `npm install`.
2. Create a `.env` file in the project folder with these variables:

   ```text
   SUPABASE_URL=your_project_url
   SUPABASE_PUBLISHABLE_KEY=your_publishable_key
   DATABASE_URL=your_postgresql_connection_string
   ```

3. Run `npm run dev` for automatic restarts, or `npm start` to run once.
4. Open `http://localhost:3000/`. Set `PORT` in the environment if port 3000 is unavailable.

The `.env` file contains connection details and must not be committed to GitHub. The Supabase project must already contain the `users`, `friendships`, and `posts` tables used by this API.

## Authentication

Sign up with an email and password, then log in. The login response contains `session.access_token`. Send that token in the `Authorization` header for protected endpoints:

```text
Authorization: Bearer <access_token>
```

Do not put a password or access token in the URL. A missing, invalid, or expired token returns `401`.

## Endpoints

| Method | Path | Token required? | Purpose |
| --- | --- | --- | --- |
| GET | `/` | No | Check that the API is running. |
| GET | `/db-check` | No | Check the PostgreSQL connection. |
| POST | `/auth/signup` | No | Create an account. Body: `email`, `password`. |
| POST | `/auth/login` | No | Log in and receive a session with an access token. Body: `email`, `password`. |
| GET | `/whoami` | Yes | Return the authenticated user's ID and email. |
| POST | `/friend` | Yes | Send a pending friend request. Body: `friendId` (the other user's UUID). |
| PATCH | `/friend/:id/accept` | Yes | Accept a pending friend request by its friendship ID; only the receiver can accept it. |
| GET | `/posts` | Optional | Return public posts, plus the signed-in user's own and accepted friends' friends-only posts. |
| POST | `/posts` | Yes | Create a post. Body: `content`, `visibility`. |

For `POST /posts`, `visibility` must be exactly `public` or `friends-only`. The API gets the author ID from the verified token, not from the request body.

Example JSON body for a public post:

```json
{
  "content": "Hello from HiBro!",
  "visibility": "public"
}
```

Example JSON body for a friend request:

```json
{
  "friendId": "00000000-0000-0000-0000-000000000000"
}
```

Replace the example UUID with a real user ID from the `users` table. A new friend request is `pending`; friends-only posts become visible to the other user only after that request is `accepted`.

## Testing

Use Postman to send requests to `http://localhost:3000`. Test both successful requests and errors such as missing fields, invalid tokens, duplicate friend requests, and trying to accept someone else's request. For `GET /posts`, compare results when anonymous, logged in as the author, and logged in as an accepted friend.
