const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const localtunnel = require('localtunnel');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: ["http://localhost:8080", "http://127.0.0.1:5501", "http://localhost:5501", "https://freakiahh.github.io"],
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors({
    origin: ["http://localhost:8080", "http://127.0.0.1:5501", "http://localhost:5501", "https://freakiahh.github.io"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/siswa', require('./routes/siswa'));
app.use('/api/rekap', require('./routes/rekap'));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Get tunnel URL
app.get('/api/tunnel-url', (req, res) => {
    res.json({ tunnelUrl: global.tunnelUrl || 'https://freakiahh-absensi.loca.lt' });
});

// WebSocket connection
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Broadcast function for real-time updates
global.io = io;

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
    // Start the server
    server.listen(PORT, HOST, async () => {
        console.log(`🚀 Server running on http://${HOST}:${PORT}`);

        // Start localtunnel for HTTPS exposure
        try {
            const tunnel = await localtunnel({ port: PORT });
            console.log(`🌐 Public URL: ${tunnel.url}`);

            // Store tunnel URL for potential use
            global.tunnelUrl = tunnel.url;

            tunnel.on('close', () => {
                console.log('Tunnel closed');
            });
        } catch (error) {
            console.error('Failed to start localtunnel:', error);
        }
    });
}

startServer();
