# SVG Compiler

A simple tool for compiling SVG files into sprites. Built with a React client and an Express + MongoDB server.

## Project Structure

- `client/` — React + Vite frontend
- `server/` — Express + MongoDB backend

## Prerequisites

- Node.js (v18+)
- npm
- MongoDB (local or remote connection string)

## Setup

### 1. Install dependencies

From the project root, run both installs:

```bash
cd server
npm install

cd ../client
npm install
```

### 2. Configure environment

Create a `.env` file in the `server/` folder:

```bash
MONGO_URI=your_mongodb_connection_string
PORT=5000
```

## Running the app

Open two terminals.

### Terminal 1 — Start the server

```bash
cd server
npm run dev
```

Server runs on `http://localhost:5000`.

### Terminal 2 — Start the client

```bash
cd client
npm run dev
```

Client runs on `http://localhost:5173`.

Open `http://localhost:5173` in your browser.

## Build (production)

### Server

```bash
cd server
npm run build
npm start
```

### Client

```bash
cd client
npm run build
npm run preview
```
