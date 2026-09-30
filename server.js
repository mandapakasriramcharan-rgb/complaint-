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
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_ymuTXZwMUdZuUo0Moh_mSQ_6bEDgDFK';

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
  const email = normalizeAdminIdentity(req.body?.email);
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'Admin email and password are required.' });
  }

  const data = readData();
  const user = data.users.find(item =>
    (item.isHost === true || item.role === 'admin') &&
    (normalizeAdminIdentity(item.email) === email || normalizeAdminIdentity(item.username) === email)
  );

  if (!user || user.role !== 'admin' || user.password !== password) {
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

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  if (supabase) {
    try {
      const authClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
      });
      const { data, error } = await authClient.auth.signInWithPassword({ email, password });

      if (!error && data.user) {
        const metadata = data.user.user_metadata || {};
        return res.json({
          user: {
            id: data.user.id,
            name: metadata.name || email.split('@')[0],
            email: data.user.email,
            phone: metadata.phone || '',
            role: metadata.role || 'student',
            adminAccessStatus: metadata.adminAccessStatus || 'pending',
            createdAt: data.user.created_at
          }
        });
      }
    } catch (error) {
      console.error('Supabase sign-in error:', error);
      return res.status(503).json({ error: 'Sign-in is temporarily unavailable. Please try again.' });
    }
  } else if (process.env.VERCEL) {
    return res.status(503).json({ error: 'Account storage is not configured. Add SUPABASE_SERVICE_KEY to the Vercel project settings.' });
  }

  try {
    const data = readData();
    const user = data.users.find(item => item.email?.trim().toLowerCase() === email);

    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const { password: discardedPassword, ...publicUser } = user;
    return res.json({ user: publicUser });
  } catch (error) {
    console.error('Local sign-in error:', error);
    return res.status(503).json({ error: 'Sign-in is temporarily unavailable. Please try again.' });
  }
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

app.post('/api/users', async (req, res) => {
  const user = req.body;

  if (!user || !user.email || !user.password) {
    return res.status(400).json({ error: 'Invalid user payload.' });
  }

  const email = String(user.email).trim().toLowerCase();
  const name = String(user.name || '').trim();
  const password = String(user.password);

  if (!name || password.length < 6) {
    return res.status(400).json({ error: 'Name and a password of at least 6 characters are required.' });
  }

  if (supabase) {
    try {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          name,
          phone: String(user.phone || ''),
          role: 'student',
          adminAccessStatus: 'pending'
        }
      });

      if (error) {
        const duplicate = /already (registered|exists)|email_exists/i.test(error.message || '');
        return res.status(duplicate ? 409 : 400).json({
          error: duplicate ? 'User already exists.' : 'Could not create the account. Check the email and try again.'
        });
      }

      return res.status(201).json({
        id: data.user.id,
        name,
        email: data.user.email,
        phone: String(user.phone || ''),
        role: 'student',
        adminAccessStatus: 'pending',
        createdAt: data.user.created_at
      });
    } catch (error) {
      console.error('Supabase account creation error:', error);
      return res.status(503).json({ error: 'Account storage is temporarily unavailable. Please try again.' });
    }
  }

  if (process.env.VERCEL) {
    return res.status(503).json({ error: 'Account storage is not configured. Add SUPABASE_SERVICE_KEY to the Vercel project settings.' });
  }

  try {
    const data = readData();
    const exists = data.users.some(item => item.email?.trim().toLowerCase() === email);
    if (exists) {
      return res.status(409).json({ error: 'User already exists.' });
    }

    const savedUser = { ...user, email, name };
    data.users.push(savedUser);
    writeData(data);
    const { password: discardedPassword, ...publicUser } = savedUser;
    return res.status(201).json(publicUser);
  } catch (error) {
    console.error('Local account creation error:', error);
    return res.status(500).json({ error: 'Could not save the account. Please try again.' });
  }
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
        })
        .abortSignal(AbortSignal.timeout(8000));

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

