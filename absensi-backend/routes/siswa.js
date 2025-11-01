const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Get all siswa
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM siswa ORDER BY nama');
        res.json(rows);
    } catch (error) {
        console.error('Get siswa error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Add siswa
router.post('/', async (req, res) => {
    try {
        const { nama, nis } = req.body;

        if (!nama || !nis) {
            return res.status(400).json({ error: 'Nama dan NIS harus diisi' });
        }

        // Validate NIS (must be numeric)
        if (!/^\d+$/.test(nis)) {
            return res.status(400).json({ error: 'NIS harus berupa angka' });
        }

        const id = Date.now().toString();

        await db.query(
            'INSERT INTO siswa (id, nama, nis) VALUES (?, ?, ?)',
            [id, nama, nis]
        );

        // Emit real-time update
        global.io.emit('siswa-added', { id, nama, nis });

        res.json({ success: true, id, nama, nis });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ error: 'NIS sudah terdaftar' });
        } else {
            console.error('Add siswa error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }
});

// Delete siswa
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        await db.query('DELETE FROM siswa WHERE id = ?', [id]);

        res.json({ success: true });

    } catch (error) {
        console.error('Delete siswa error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
