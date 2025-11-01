const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/database');

// SHA-256 Hash function
function sha256(message) {
    return crypto.createHash('sha256').update(message).digest('hex');
}

// Generate token
function generateToken() {
    const date = new Date();
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    return `F1${day}${month}${random}`;
}

// Login operator
router.post('/login', async (req, res) => {
    try {
        const { nickname, password } = req.body;

        if (!nickname || !password) {
            return res.status(400).json({ error: 'Nickname dan password harus diisi' });
        }

        const hashedPassword = sha256(password);
        
        const [rows] = await db.query(
            'SELECT * FROM operators WHERE nickname = ? AND password = ?',
            [nickname, hashedPassword]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Login gagal! Cek nickname atau password.' });
        }

        const operator = rows[0];
        
        // Update token if needed
        const today = new Date().toISOString().split('T')[0];
        if (operator.tanggal !== today) {
            const newToken = generateToken();
            await db.query(
                'UPDATE operators SET token_harian = ?, tanggal = ? WHERE id = ?',
                [newToken, today, operator.id]
            );
            operator.token_harian = newToken;
            operator.tanggal = today;
        }

        res.json({ 
            success: true, 
            operator: {
                id: operator.id,
                nickname: operator.nickname,
                token_harian: operator.token_harian
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get current token
router.get('/token', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const [rows] = await db.query('SELECT * FROM operators LIMIT 1');
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Operator not found' });
        }

        let operator = rows[0];

        // Update token if date changed
        if (operator.tanggal !== today) {
            const newToken = generateToken();
            await db.query(
                'UPDATE operators SET token_harian = ?, tanggal = ? WHERE id = ?',
                [newToken, today, operator.id]
            );
            operator.token_harian = newToken;
            operator.tanggal = today;
        }

        res.json({ 
            token_harian: operator.token_harian,
            tanggal: operator.tanggal 
        });

    } catch (error) {
        console.error('Token error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Validate token
router.post('/validate-token', async (req, res) => {
    try {
        const { token } = req.body;
        const today = new Date().toISOString().split('T')[0];
        
        const [rows] = await db.query(
            'SELECT * FROM operators WHERE token_harian = ? AND tanggal = ?',
            [token, today]
        );

        res.json({ valid: rows.length > 0 });

    } catch (error) {
        console.error('Validate token error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;