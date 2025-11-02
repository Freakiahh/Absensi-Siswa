const express = require('express');
const router = express.Router();
const db = require('../config/database');

// ==================== UTILITY FUNCTIONS ====================

// Get local date (fix timezone issue)
function getLocalDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Get week dates (Mon-Sun)
function getWeekDates() {
    const today = new Date();
    const dates = [];

    // Handle Sunday (0) edge case
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);

    // Generate 7 days, but only up to today
    for (let i = 0; i < 7; i++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + i);

        if (date <= today) {
            dates.push(getLocalDate(date));
        }
    }

    return dates;
}

// Get month dates (only up to today)
function getMonthDates() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const dates = [];

    const lastDay = new Date(year, month + 1, 0).getDate();

    for (let i = 1; i <= lastDay; i++) {
        const currentDate = new Date(year, month, i);

        // Only include dates up to today
        if (currentDate <= today) {
            dates.push(getLocalDate(currentDate));
        }
    }

    return dates;
}

// ==================== ROUTES ====================

// Get rekap (with filters)
router.get('/', async (req, res) => {
    try {
        const { filter, startDate, endDate } = req.query;
        let query = 'SELECT * FROM rekap';
        let params = [];

        if (filter === 'hari') {
            const today = getLocalDate(); // Use local date
            query += ' WHERE tanggal = ?';
            params.push(today);
        } else if (filter === 'minggu') {
            const dates = getWeekDates();
            if (dates.length > 0) {
                query += ' WHERE tanggal IN (?)';
                params.push(dates);
            }
        } else if (filter === 'bulan') {
            const dates = getMonthDates();
            if (dates.length > 0) {
                query += ' WHERE tanggal IN (?)';
                params.push(dates);
            }
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
        const today = getLocalDate(); // Use local date
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

// Get statistics (FIXED)
router.get('/statistics', async (req, res) => {
    try {
        const { dates } = req.query;

        // 1. Get total siswa
        const [totalSiswaResult] = await db.query('SELECT COUNT(*) as total FROM siswa');
        const totalSiswa = totalSiswaResult[0].total;

        // 2. Get attendance data
        let query = `
SELECT status, COUNT(*) as count
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

        // 3. Calculate statistics
        const stats = {
            hadir: 0,
            izin: 0,
            sakit: 0,
            alpa: 0,
            belum_absen: 0,
            total: totalSiswa
        };

        rows.forEach(row => {
            const statusLower = row.status.toLowerCase();
            if (stats.hasOwnProperty(statusLower)) {
                stats[statusLower] = row.count;
            }
        });

        // 4. Calculate "belum absen"
        const totalAbsen = stats.hadir + stats.izin + stats.sakit + stats.alpa;
        stats.belum_absen = totalSiswa - totalAbsen;

        res.json(stats);
    } catch (error) {
        console.error('Get statistics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get rekap by specific date (NEW ENDPOINT)
router.get('/by-date', async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'Date parameter is required' });
        }

        const query = 'SELECT * FROM rekap WHERE tanggal = ? ORDER BY nis';
        const [rows] = await db.query(query, [date]);

        res.json(rows);
    } catch (error) {
        console.error('Get rekap by date error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get siswa yang belum absen (NEW ENDPOINT)
router.get('/belum-absen', async (req, res) => {
    try {
        const { tanggal } = req.query;
        const targetDate = tanggal || getLocalDate();

        // Get all siswa
        const [allSiswa] = await db.query('SELECT * FROM siswa ORDER BY nama');

        // Get siswa yang sudah absen
        const [sudahAbsen] = await db.query(
            'SELECT nis FROM rekap WHERE tanggal = ?',
            [targetDate]
        );

        const sudahAbsenNIS = new Set(sudahAbsen.map(r => r.nis));

        // Filter siswa yang belum absen
        const belumAbsen = allSiswa.filter(s => !sudahAbsenNIS.has(s.nis));

        res.json(belumAbsen);
    } catch (error) {
        console.error('Get belum absen error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
