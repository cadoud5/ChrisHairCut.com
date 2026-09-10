const request = require('supertest');

jest.mock('../db');
const pool = require('../db');

// The public booking route sends two emails and creates a calendar event —
// mock both so tests never touch real SMTP/Google Calendar network calls.
jest.mock('../emails/mailer', () => ({
  sendEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../calendar', () => ({
  createEvent: jest.fn().mockRejectedValue(new Error('no calendar credentials in tests')),
  deleteEvent: jest.fn(),
  getEvents: jest.fn(),
}));

const app = require('../app');

beforeEach(() => {
  pool.query.mockReset();
});

describe('POST /api/bookings (public) — phone number validation', () => {
  const basePayload = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    service: 'Mens Haircut',
    price: '$17.00',
    startDate: '2026-09-10T11:00:00-05:00',
    endDate: '2026-09-10T11:30:00-05:00',
    agreedToTerms: true,
  };

  test('rejects an obviously too-short phone number', async () => {
    const res = await request(app).post('/api/bookings').send({ ...basePayload, phone: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid 10-digit phone number/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('rejects a phone number with letters mixed in', async () => {
    const res = await request(app).post('/api/bookings').send({ ...basePayload, phone: '773-abc-0148' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid 10-digit phone number/i);
  });

  test('rejects 10 valid digits with garbage letters trailing (digit-count bypass)', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ ...basePayload, phone: '7738145649asdpiaudoiuhaeoieuhoaiudhf' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid 10-digit phone number/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('rejects a phone number that is too long', async () => {
    const res = await request(app).post('/api/bookings').send({ ...basePayload, phone: '773-814-0148-99999' });
    expect(res.status).toBe(400);
  });

  test('accepts a properly formatted 10-digit phone number', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // existing-account lookup by email
      .mockResolvedValueOnce({ rows: [{ id: 1, ...basePayload, phone: '773-814-0148', status: 'pending' }] }); // INSERT

    const res = await request(app).post('/api/bookings').send({ ...basePayload, phone: '773-814-0148' });
    expect(res.status).toBe(201);
  });

  test('accepts a phone number with a leading 1 country code', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 2, ...basePayload, phone: '1-773-814-0148', status: 'pending' }] });

    const res = await request(app).post('/api/bookings').send({ ...basePayload, phone: '1-773-814-0148' });
    expect(res.status).toBe(201);
  });

  test('accepts a plain unformatted 10-digit phone number', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 3, ...basePayload, phone: '7738140148', status: 'pending' }] });

    const res = await request(app).post('/api/bookings').send({ ...basePayload, phone: '7738140148' });
    expect(res.status).toBe(201);
  });
});
