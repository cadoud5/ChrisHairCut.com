const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendEmail } = require('../emails/mailer');
const { verifyToken, requireAdmin, optionalAuth } = require('../middleware/auth');
const { createEvent, deleteEvent, getEvents } = require('../calendar');
const { body, validationResult } = require('express-validator');
const { escapeHtml } = require('../utils/escapeHtml');

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return true;
  }
  return false;
}

function readableDate(dateStr) {
  return new Date(dateStr).toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago'
  });
}

router.post('/',
  optionalAuth,
  [
    body('name').trim().isLength({ min: 1, max: 150 }).withMessage('Name is required'),
    body('phone').trim().custom(value => {
      // Only digits and common phone-formatting characters are allowed at
      // all — anything else (letters, symbols) fails immediately, so a
      // string like "7738140148asdf" can't sneak through just because it
      // happens to contain exactly 10 digits somewhere in it.
      if (!/^[\d\s().+-]+$/.test(value)) {
        throw new Error('Please enter a valid 10-digit phone number');
      }
      const digits = value.replace(/\D/g, '');
      // Accept 10-digit US numbers, optionally with a leading country code 1.
      if (digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))) {
        return true;
      }
      throw new Error('Please enter a valid 10-digit phone number');
    }),
    body('email').trim().isEmail().withMessage('Please enter a valid email').normalizeEmail(),
    body('service').trim().isLength({ min: 1, max: 200 }).withMessage('Service is required'),
    body('price').trim().isLength({ min: 1, max: 30 }).withMessage('Price is required'),
    body('startDate').isISO8601().withMessage('Invalid start date'),
    body('endDate').isISO8601().withMessage('Invalid end date'),
    body('notes').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }).withMessage('Notes are too long'),
    body('agreedToTerms').custom(value => value === true).withMessage('You must agree to the Terms of Service to book an appointment'),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const { name, phone, email, service, price, startDate, endDate, notes } = req.body;
    let userId = req.user ? req.user.id : null;

    // If booking as a guest, check if an account already exists with this email
    // and auto-link the booking to it — no login required for this to happen.
    if (!userId) {
      try {
        const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
          userId = existingUser.rows[0].id;
        }
      } catch (linkErr) {
        console.error('Failed to check for existing account by email:', linkErr.message);
        // Not fatal — booking still proceeds as a guest booking if this lookup fails
      }
    }

  try {
    let calendarEventId = null;
    try {
      const event = await createEvent({
        summary: `${service} — ${name}`,
        description: `Phone: ${phone}\nEmail: ${email}\nPrice: ${price}\nNotes: ${notes || 'None'}`,
        startDateTime: startDate,
        endDateTime: endDate,
        location: 'UIC Roosevelt Road Building, Chicago, IL',
      });
      calendarEventId = event.id;
    } catch (calErr) {
      console.error('Calendar event creation failed:', calErr.message);
    }

    const result = await pool.query(
      `INSERT INTO bookings (name, phone, email, service, price, start_date, end_date, notes, calendar_event_id, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [name, phone, email, service, price, startDate, endDate, notes, calendarEventId, userId]
    );

    const booking = result.rows[0];
    const dateStr = readableDate(startDate);

    await sendEmail({
      to: email,
      subject: `Appointment Requested — ${dateStr}`,
      html: `
        <h2>Appointment Requested</h2>
        <p>Hi ${escapeHtml(name)},</p>
        <p>Thanks for booking! Your appointment request has been received and is <strong>pending confirmation</strong>:</p>
        <ul>
          <li><strong>Service:</strong> ${escapeHtml(service)}</li>
          <li><strong>Date:</strong> ${dateStr}</li>
          <li><strong>Price:</strong> ${escapeHtml(price)}</li>
        </ul>
        <p>You'll receive another email once Chris confirms your appointment.</p>
        <p>Questions? Text or call 773.314.0148.</p>
      `
    });

    await sendEmail({
      to: process.env.GMAIL_USER,
      subject: `New Booking Request — ${name}`,
      html: `
        <h2>New appointment requested</h2>
        <ul>
          <li><strong>Name:</strong> ${escapeHtml(name)}</li>
          <li><strong>Phone:</strong> ${escapeHtml(phone)}</li>
          <li><strong>Email:</strong> ${escapeHtml(email)}</li>
          <li><strong>Service:</strong> ${escapeHtml(service)}</li>
          <li><strong>Date:</strong> ${dateStr}</li>
          <li><strong>Price:</strong> ${escapeHtml(price)}</li>
          <li><strong>Notes:</strong> ${notes ? escapeHtml(notes) : 'None'}</li>
        </ul>
      `
    });

    res.status(201).json(booking);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
  }
);

// Admin-only: manually add an appointment (walk-in, phone booking, etc.)
// Skips the "agreedToTerms" requirement since the customer isn't filling
// this out themselves, and marks the booking confirmed right away instead
// of pending. Email is optional — walk-ins often don't have one on file.
router.post('/manual',
  verifyToken,
  requireAdmin,
  [
    // Every field here is optional — admins can add a placeholder appointment
    // with as little info as they have on hand and fill in the rest later.
    // Sensible defaults for anything left blank are applied below, since the
    // bookings table itself still requires non-null values for these columns.
    body('name').optional({ checkFalsy: true }).trim().isLength({ max: 150 }).withMessage('Name is too long'),
    body('phone').optional({ checkFalsy: true }).trim().isLength({ max: 20 }).withMessage('Phone number is too long'),
    body('email').optional({ checkFalsy: true }).trim().isEmail().withMessage('Please enter a valid email').normalizeEmail(),
    body('service').optional({ checkFalsy: true }).trim().isLength({ max: 200 }).withMessage('Service name is too long'),
    body('price').optional({ checkFalsy: true }).trim().isLength({ max: 30 }).withMessage('Price is too long'),
    body('startDate').optional({ checkFalsy: true }).isISO8601().withMessage('Invalid start date'),
    body('endDate').optional({ checkFalsy: true }).isISO8601().withMessage('Invalid end date'),
    body('notes').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }).withMessage('Notes are too long'),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const name = req.body.name || 'Walk-in Client';
    const phone = req.body.phone || '';
    const service = req.body.service || 'N/A';
    const price = req.body.price || 'N/A';
    const notes = req.body.notes || '';
    const email = req.body.email || '';

    // Default a missing start time to right now, and a missing end time to
    // 30 minutes after the (possibly just-defaulted) start time.
    const startDate = req.body.startDate || new Date().toISOString();
    const endDate = req.body.endDate || new Date(new Date(startDate).getTime() + 30 * 60000).toISOString();

    // If this client already has an account, link the booking to it
    // (same lookup the public booking route does for guests).
    let userId = null;
    if (email) {
      try {
        const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
          userId = existingUser.rows[0].id;
        }
      } catch (linkErr) {
        console.error('Failed to check for existing account by email:', linkErr.message);
      }
    }

    try {
      let calendarEventId = null;
      try {
        const event = await createEvent({
          summary: `${service} — ${name}`,
          description: `Phone: ${phone}\nEmail: ${email || 'N/A'}\nPrice: ${price}\nNotes: ${notes || 'None'}\n(Added manually via admin dashboard)`,
          startDateTime: startDate,
          endDateTime: endDate,
          location: 'UIC Roosevelt Road Building, Chicago, IL',
        });
        calendarEventId = event.id;
      } catch (calErr) {
        console.error('Calendar event creation failed:', calErr.message);
      }

      const result = await pool.query(
        `INSERT INTO bookings (name, phone, email, service, price, start_date, end_date, notes, calendar_event_id, user_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'confirmed')
         RETURNING *`,
        [name, phone, email, service, price, startDate, endDate, notes, calendarEventId, userId]
      );

      const booking = result.rows[0];

      if (email) {
        const dateStr = readableDate(startDate);
        try {
          await sendEmail({
            to: email,
            subject: `Appointment Confirmed — ${dateStr}`,
            html: `
              <h2>Appointment Confirmed!</h2>
              <p>Hi ${escapeHtml(name)},</p>
              <p>You're booked in:</p>
              <ul>
                <li><strong>Service:</strong> ${escapeHtml(service)}</li>
                <li><strong>Date:</strong> ${dateStr}</li>
                <li><strong>Price:</strong> ${escapeHtml(price)}</li>
              </ul>
              <p>See you then! Questions? Text or call 773.314.0148.</p>
            `
          });
        } catch (emailErr) {
          console.error('Confirmation email failed:', emailErr.message);
        }
      }

      res.status(201).json(booking);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create booking' });
    }
  }
);

router.get('/', verifyToken, requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const result = await pool.query('SELECT * FROM bookings ORDER BY start_date ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Logged-in customer's own bookings
router.get('/mine', verifyToken, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const result = await pool.query(
      'SELECT * FROM bookings WHERE user_id = $1 ORDER BY start_date DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch your bookings' });
  }
});

router.patch('/:id',
  verifyToken,
  requireAdmin,
  [
    body('status').optional().isIn(['pending', 'confirmed', 'completed', 'cancelled']).withMessage('Invalid status'),
    body('paid_amount').optional({ checkFalsy: true }).trim().isLength({ max: 30 }).withMessage('Paid amount is too long'),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const { id } = req.params;
    const { status, paid_amount } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    const before = existing.rows[0];

    if (before.archived) {
      return res.status(400).json({ error: 'This appointment is archived. Unarchive it before making changes.' });
    }

    const result = await pool.query(
      `UPDATE bookings
       SET status = COALESCE($1, status),
           paid_amount = COALESCE($2, paid_amount)
       WHERE id = $3
       RETURNING *`,
      [status || null, paid_amount || null, id]
    );

    const booking = result.rows[0];
    const dateStr = readableDate(booking.start_date);

    // Send status-change emails only when the status actually changed
    if (status && status !== before.status) {

      if (status === 'confirmed') {
        await sendEmail({
          to: booking.email,
          subject: `Appointment Confirmed — ${dateStr}`,
          html: `
            <h2>Appointment Confirmed!</h2>
            <p>Hi ${escapeHtml(booking.name)},</p>
            <p>Your appointment is <strong>confirmed</strong>:</p>
            <ul>
              <li><strong>Service:</strong> ${escapeHtml(booking.service)}</li>
              <li><strong>Date:</strong> ${dateStr}</li>
              <li><strong>Price:</strong> ${escapeHtml(booking.price)}</li>
            </ul>
            <p>See you then! Questions? Text or call 773.314.0148.</p>
          `
        });
      }

      if (status === 'cancelled') {
        // remove the calendar event if it exists
        if (booking.calendar_event_id) {
          try {
            await deleteEvent(booking.calendar_event_id);
          } catch (calErr) {
            console.error('Calendar event deletion failed:', calErr.message);
          }
        }

        await sendEmail({
          to: booking.email,
          subject: `Appointment Cancelled — ${dateStr}`,
          html: `
            <h2>Appointment Cancelled</h2>
            <p>Hi ${escapeHtml(booking.name)},</p>
            <p>Your appointment has been <strong>cancelled</strong>:</p>
            <ul>
              <li><strong>Service:</strong> ${escapeHtml(booking.service)}</li>
              <li><strong>Date:</strong> ${dateStr}</li>
            </ul>
            <p>If this was a mistake or you'd like to rebook, text or call 773.314.0148.</p>
          `
        });
      }
    }

    res.json(booking);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
  }
);

// Archive/unarchive — archived appointments are read-only (see the
// early-return in PATCH /:id above) until they're unarchived here.
router.patch('/:id/archive',
  verifyToken,
  requireAdmin,
  [
    body('archived').isBoolean().withMessage('archived must be true or false'),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const { id } = req.params;
    const { archived } = req.body;

    try {
      const result = await pool.query(
        `UPDATE bookings SET archived = $1 WHERE id = $2 RETURNING *`,
        [archived, id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Booking not found' });
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update archive status' });
    }
  }
);

router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const existing = await pool.query('SELECT calendar_event_id FROM bookings WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const eventId = existing.rows[0].calendar_event_id;
    if (eventId) {
      try {
        await deleteEvent(eventId);
      } catch (calErr) {
        console.error('Calendar event deletion failed:', calErr.message);
      }
    }

    await pool.query('DELETE FROM bookings WHERE id = $1', [id]);
    res.json({ message: 'Booking deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

router.get('/availability', async (req, res) => {
  const { start, end } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: 'start and end query params required' });
  }

  try {
    const events = await getEvents(start, end);
    const busySlots = events.map(e => ({
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date,
      summary: e.summary,
    }));
    res.json(busySlots);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

module.exports = router;