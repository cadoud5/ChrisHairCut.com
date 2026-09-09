const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../db');
const pool = require('../db');

const app = require('../app');

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

beforeEach(() => {
  pool.query.mockReset();
});

describe('GET /api/bookings (admin-only route)', () => {
  test('rejects requests with no token', async () => {
    const res = await request(app).get('/api/bookings');
    expect(res.status).toBe(401);
  });

  test('rejects requests with a garbage/invalid token', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  test('rejects a valid token belonging to a non-admin customer', async () => {
    const token = tokenFor({ id: 2, role: 'customer' });
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled(); // never even reaches the DB
  });

  test('allows a valid admin token through', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test Booking' }] });
    const token = tokenFor({ id: 1, role: 'admin' });

    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('POST /api/bookings/manual (admin-only route)', () => {
  const payload = {
    name: 'Walk-in Client',
    phone: '773-555-0100',
    service: 'Buzzcut — $10.00 · 30 min',
    price: '$10.00',
    startDate: '2026-09-10T11:00:00-05:00',
    endDate: '2026-09-10T11:30:00-05:00',
  };

  test('rejects requests with no token', async () => {
    const res = await request(app).post('/api/bookings/manual').send(payload);
    expect(res.status).toBe(401);
  });

  test('rejects a valid token belonging to a non-admin customer', async () => {
    const token = tokenFor({ id: 2, role: 'customer' });
    const res = await request(app)
      .post('/api/bookings/manual')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('allows a valid admin token to create a manual booking', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 10, ...payload, status: 'confirmed' }],
    });
    const token = tokenFor({ id: 1, role: 'admin' });

    const res = await request(app)
      .post('/api/bookings/manual')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('confirmed');
  });

  test('accepts a completely empty payload and fills in defaults', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 11, name: 'Walk-in Client', phone: '', service: 'N/A', price: 'N/A', status: 'confirmed' }],
    });
    const token = tokenFor({ id: 1, role: 'admin' });

    const res = await request(app)
      .post('/api/bookings/manual')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Walk-in Client');
    expect(res.body.status).toBe('confirmed');
  });
});

describe('PATCH /api/bookings/:id/archive (admin-only route)', () => {
  test('rejects requests with no token', async () => {
    const res = await request(app).patch('/api/bookings/5/archive').send({ archived: true });
    expect(res.status).toBe(401);
  });

  test('rejects a valid token belonging to a non-admin customer', async () => {
    const token = tokenFor({ id: 2, role: 'customer' });
    const res = await request(app)
      .patch('/api/bookings/5/archive')
      .set('Authorization', `Bearer ${token}`)
      .send({ archived: true });

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('allows a valid admin token to archive a booking', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5, archived: true }] });
    const token = tokenFor({ id: 1, role: 'admin' });

    const res = await request(app)
      .patch('/api/bookings/5/archive')
      .set('Authorization', `Bearer ${token}`)
      .send({ archived: true });

    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);
  });
});

describe('PATCH /api/bookings/:id (blocked while archived)', () => {
  test('refuses to edit a booking that is archived', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 7, status: 'pending', archived: true }] });
    const token = tokenFor({ id: 1, role: 'admin' });

    const res = await request(app)
      .patch('/api/bookings/7')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'confirmed' });

    expect(res.status).toBe(400);
    // only the lookup query ran — no UPDATE was attempted
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/bookings/mine (customer-scoped route)', () => {
  test('only ever queries bookings for the logged-in user\'s own id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const token = tokenFor({ id: 42, role: 'customer' });

    await request(app)
      .get('/api/bookings/mine')
      .set('Authorization', `Bearer ${token}`);

    // The route must scope the query to req.user.id (42), not take an id from
    // the client — this is what prevents one customer from reading another's bookings.
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE user_id = $1'),
      [42]
    );
  });
});

describe('DELETE /api/reviews/mine/:id (ownership check)', () => {
  test('blocks a customer from deleting a review that belongs to someone else', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 5, user_id: 999, photo_url: null }], // review belongs to user 999
    });
    const token = tokenFor({ id: 42, role: 'customer' }); // request comes from user 42

    const res = await request(app)
      .delete('/api/reviews/mine/5')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});