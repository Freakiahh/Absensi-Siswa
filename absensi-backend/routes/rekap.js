const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Get rekap (with filters)
router.get('/', async (req, res) => {
    try {
        const { filter, startDate, endDate } = req.query;
        let query = 'SELECT * FROM rekap';
        let params = [];

        if (filter === 'hari') {
            const today = new Date().toISOString().split('T')[0];
            query += ' WHERE tanggal = ?';
            params.push(today);
        } else if (filter === 'minggu') {
            const today = new Date();
            const monday = new Date(today);
            monday.setDate(today.getDate() - today.getDay() + 1);

            const dates = [];
            for (let i = 0; i < 5; i++) {
                const date = new Date(monday);
                date.setDate(monday.getDate() + i);
                dates.push(date.toISOString().split('T')[0]);
            }

            query += ' WHERE tanggal IN (?)';
            params.push(dates);
        } else if (startDate && endDate) {
            query += ' WHERE tanggal BETWEEN ? AND ?';
            params.push(startDate, endDate);
        }

        query += ' ORDER BY tanggal DESC, nis';

        const [rows] = await db.query(query, params);
        res.json(rows);

    } catch (error) {
        console.error('Get rekap error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Add absensi
router.post('/', async (req, res) => {
    try {
        const { nis, token } = req.body;

        if (!nis || !token) {
            return res.status(400).json({ error: 'NIS dan token harus diisi' });
        }

        // Validate token
        const today = new Date().toISOString().split('T')[0];
        const [tokenRows] = await db.query(
            'SELECT * FROM operators WHERE token_harian = ? AND tanggal = ?',
            [token, today]
        );

        if (tokenRows.length === 0) {
            return res.status(400).json({ error: 'Token tidak valid atau sudah expired' });
        }

        // Check if siswa exists
        const [siswaRows] = await db.query('SELECT * FROM siswa WHERE nis = ?', [nis]);

        if (siswaRows.length === 0) {
            return res.status(404).json({ error: 'NIS tidak ditemukan' });
        }

        const id = Date.now().toString();

        await db.query(
            'INSERT INTO rekap (id, nis, tanggal, status) VALUES (?, ?, ?, ?)',
            [id, nis, today, 'Hadir']
        );

        // Emit real-time update
        global.io.emit('absensi-added', { id, nis, tanggal: today, status: 'Hadir' });

        res.json({
            success: true,
            id,
            nis,
            tanggal: today,
            status: 'Hadir'
        });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ error: 'Anda sudah absen hari ini' });
        } else {
            console.error('Add absensi error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }
});

// Update status
router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['Hadir', 'Izin', 'Sakit', 'Alpa'].includes(status)) {
            return res.status(400).json({ error: 'Status tidak valid' });
        }

        await db.query(
            'UPDATE rekap SET status = ? WHERE id = ?',
            [status, id]
        );

        // Emit real-time update
        global.io.emit('status-updated', { id, status });

        res.json({ success: true });

    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get statistics
router.get('/statistics', async (req, res) => {
    try {
        const { dates } = req.query; // Comma-separated dates

        let query = `
            SELECT 
                status,
                COUNT(*) as count
            FROM rekap
        `;

        let params = [];

        if (dates) {
            const dateArray = dates.split(',');
            query += ' WHERE tanggal IN (?)';
            params.push(dateArray);
        }

        query += ' GROUP BY status';

        const [rows] = await db.query(query, params);

        const stats = {
            hadir: 0,
            izin: 0,
            sakit: 0,
            alpa: 0,
            total: 0
        };

        rows.forEach(row => {
            stats[row.status.toLowerCase()] = row.count;
            stats.total += row.count;
        });

        res.json(stats);

    } catch (error) {
        console.error('Get statistics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
