const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gxuxtfmczgrvlhpghpor.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const supabase = SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

if (!supabase) {
  console.warn('Supabase is not configured yet. Using local JSON storage only. Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable cloud sync.');
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = {
      users: [
        {
          id: 'HOST-1',
          name: 'Host Admin',
          username: 'admin@routewise.com',
          email: 'admin@routewise.com',
          phone: '',
          password: 'admin123',
          role: 'admin',
          isHost: true,
          createdAt: new Date().toISOString()
        }
      ],
      complaints: [],
      notifications: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
  }
}

function normalizeAdminIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function migrateLegacyHostAccount(data) {
  const users = Array.isArray(data.users) ? data.users : [];
  const adminEmails = ['host@gmail.com', 'admin@routewise.com'];
  const host = users.find(user =>
    user.isHost === true ||
    adminEmails.includes(normalizeAdminIdentity(user.username)) ||
    adminEmails.includes(normalizeAdminIdentity(user.email))
  );

  if (!host) {
    return data;
  }

  host.role = 'admin';
  host.isHost = true;
  host.username = 'admin@routewise.com';
  host.email = 'admin@routewise.com';
  host.password = 'admin123';
  return data;
}

function readData() {
  ensureDataFile();
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const migrated = migrateLegacyHostAccount(data);

  if (JSON.stringify(migrated) !== JSON.stringify(data)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(migrated, null, 2));
  }

  return migrated;
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/init', (req, res) => {
  const data = readData();
  res.json({
    users: data.users,
    complaints: data.complaints,
    notifications: data.notifications,
    host: data.users.find(user => user.isHost === true) || null
  });
});

app.get('/api/users', (req, res) => {
  const data = readData();
  res.json(data.users);
});

app.get('/api/complaints', (req, res) => {
  const data = readData();
  res.json(data.complaints);
});

app.post('/api/auth/admin-login', (req, res) => {
  const data = readData();
  const user = data.users.find(item => item.isHost === true || item.role === 'admin') || data.users[0];

  if (!user || user.role !== 'admin') {
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  }

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  });
});

app.put('/api/auth/admin-access', (req, res) => {
  const hostEmail = String(req.body?.hostEmail || '').trim().toLowerCase();
  const currentPassword = String(req.body?.currentPassword || '');
  const userId = String(req.body?.userId || '');
  const decision = String(req.body?.decision || '');

  if (!hostEmail || !currentPassword || !userId || !['grant', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'Host credentials and a valid account decision are required.' });
  }

  const data = readData();
  const host = data.users.find(user => user.isHost === true);
  const hostLoginMatches = host && (
    host.email?.trim().toLowerCase() === hostEmail ||
    host.username?.trim().toLowerCase() === hostEmail
  );

  if (!hostLoginMatches || host.password !== currentPassword) {
    return res.status(401).json({ error: 'Current host admin credentials are incorrect.' });
  }

  const user = data.users.find(item => item.id === userId);
  if (!user || user.isHost === true) {
    return res.status(404).json({ error: 'Account not found.' });
  }

  user.role = decision === 'grant' ? 'admin' : 'student';
  user.adminAccessStatus = decision === 'grant' ? 'approved' : 'denied';
  user.adminAccessReviewedAt = new Date().toISOString();
  writeData(data);
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post('/api/users', (req, res) => {
  const data = readData();
  const user = req.body;

  if (!user || !user.email || !user.password) {
    return res.status(400).json({ error: 'Invalid user payload.' });
  }

  const exists = data.users.some(item => item.email?.toLowerCase() === user.email.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'User already exists.' });
  }

  data.users.push(user);
  writeData(data);
  res.status(201).json(user);
});
app.post('/api/complaints', async (req, res) => {
  const data = readData();
  const complaint = req.body;

  const reference = String(
    complaint?.reference || complaint?.id || ''
  ).trim();

  if (
    !complaint ||
    !reference ||
    !complaint.userId ||
    !complaint.description
  ) {
    return res.status(400).json({
      error: 'Invalid complaint payload.'
    });
  }

  const exists = data.complaints.some(item =>
    String(item.reference || item.id || '').trim() === reference
  );

  if (exists) {
    return res.status(409).json({
      error: 'Complaint reference already exists. Please submit again.'
    });
  }

  try {
    if (supabase) {
      const { error } = await supabase
        .from('complaints')
        .insert({
          name: complaint.name || '',
          email: complaint.email || '',
          phone: complaint.phone || '',
          complaint: complaint.description || '',
          status: complaint.status || 'New',
          priority: complaint.priority || 'Medium',
          route: complaint.route || '',
          location: complaint.location || ''
        });

      if (error) {
        console.error('Supabase complaint insert error:', error);
      }
    } else {
      console.warn('Supabase not configured: complaint saved locally only.');
    }

    data.complaints.unshift(complaint);
    writeData(data);

    res.status(201).json(complaint);

  } catch (error) {
    console.error('Complaint save error:', error);

    data.complaints.unshift(complaint);
    writeData(data);

    res.status(201).json(complaint);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`RouteWise server running at http://localhost:${PORT}`);
  });
}

module.exports = app;

