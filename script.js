const blockedSlots = {
  '2026-05-31': ['all'],
  '2026-06-01': ['12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM'],
  '2026-06-04': ['4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM', '6:00 PM', '6:30 PM'],
  '2026-06-05': ['4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM', '6:00 PM', '6:30 PM'],
};

const dayMap = ['sun','mon','tue','wed','thu','fri','sat'];
const todayKey = dayMap[new Date().getDay()];
const row = document.getElementById('row-' + todayKey);
if (row) row.classList.add('today');

const d = new Date();
const dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
document.getElementById('m-date').min = dateStr;

function switchTab(tab) {
  document.getElementById('tab-services').classList.toggle('active', tab === 'services');
  document.getElementById('tab-staff').classList.toggle('active', tab === 'staff');
  document.getElementById('panel-services').classList.toggle('hidden', tab !== 'services');
  document.getElementById('panel-staff').classList.toggle('visible', tab === 'staff');
}

function openModal(service) {
  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('modalForm').classList.remove('hidden');
  document.getElementById('modalSuccess').classList.remove('visible');
  const btn = document.getElementById('submitBtn');
  btn.textContent = 'Confirm Booking Request';
  btn.disabled = false;
  if (service) {
    const sel = document.getElementById('m-service');
    Array.from(sel.options).forEach(o => {
      if (o.text.startsWith(service)) sel.value = o.value;
    });
  }
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

function closeModalOutside(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

document.getElementById('m-date').addEventListener('change', function() {
  const selected = this.value;
  const timeSelect = document.getElementById('m-time');
  const blocked = blockedSlots[selected] || [];

  const normalize = str => str.replace(/\s+/g, '').toLowerCase();
  const normalizedBlocked = blocked.map(normalize);

  Array.from(timeSelect.options).forEach(opt => {
    if (opt.value === '') return;
    const isBlocked = blocked.includes('all') || normalizedBlocked.includes(normalize(opt.text.replace(' — unavailable', '')));
    opt.disabled = isBlocked;
    opt.text = isBlocked
      ? opt.text.replace(' — unavailable', '') + ' — unavailable'
      : opt.text.replace(' — unavailable', '');
  });

  timeSelect.value = '';
});

const EMAILJS_PUBLIC_KEY   = 'gX15PgeZlIn8eiMX0';
const EMAILJS_SERVICE_ID   = 'service_gb4dubg';
const OWNER_TEMPLATE_ID    = 'template_gmmwedq';
const CUSTOMER_TEMPLATE_ID = 'template_jm9dz3w';

emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });

function timeTo24hr(t) {
  const [time, modifier] = t.split(' ');
  let [hours, minutes] = time.split(':');
  hours = parseInt(hours);
  if (modifier === 'PM' && hours !== 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;
  return String(hours).padStart(2,'0') + ':' + minutes + ':00';
}

async function submitForm(e) {
  e.preventDefault();

  const btn = document.getElementById('submitBtn');
  btn.textContent = 'Confirming...';
  btn.disabled = true;

  const prices = {
    'Mens Haircut — $17.00 · 30 min': '$17.00',
    'Buzzcut — $10.00 · 30 min': '$10.00',
    'UIC Student — $13.00 · 30 min': '$13.00',
  };

  const rawDate = document.getElementById('m-date').value;
  const rawTime = document.getElementById('m-time').value;

  const startDateTime = rawDate + 'T' + timeTo24hr(rawTime);
  const endHour = String(parseInt(timeTo24hr(rawTime).slice(0,2)) + 1).padStart(2,'0');
  const endDateTime = rawDate + 'T' + endHour + ':' + timeTo24hr(rawTime).slice(3);

  const p = {
    customer_name:  document.getElementById('m-fname').value.trim() + ' ' +
                    document.getElementById('m-lname').value.trim(),
    customer_phone: document.getElementById('m-phone').value.trim(),
    customer_email: document.getElementById('m-email').value.trim(),
    to_email:       document.getElementById('m-email').value.trim(),
    from_email:     'chrishaircut07@gmail.com',
    service:        document.getElementById('m-service').value,
    price:          prices[document.getElementById('m-service').value] || 'N/A',
    date:           rawDate,
    time:           rawTime,
    notes:          document.getElementById('m-notes').value.trim() || 'None',
  };

  try {
    // Email 1 → customer confirmation
    p.to_email = document.getElementById('m-email').value.trim();
    await emailjs.send(EMAILJS_SERVICE_ID, OWNER_TEMPLATE_ID, p);

    // Email 2 → notify you
    p.to_email = 'chrishaircut07@gmail.com';
    await emailjs.send(EMAILJS_SERVICE_ID, OWNER_TEMPLATE_ID, p);

    // Send to Make.com for Outlook Calendar
    await fetch('https://hook.us2.make.com/llxu9px6vjsmuqfgnvlba2av6yz3miol', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:       p.customer_name,
        phone:      p.customer_phone,
        email:      p.customer_email,
        service:    p.service,
        price:      p.price,
        startDate:  startDateTime,
        endDate:    endDateTime,
        notes:      p.notes,
      })
    });

    document.getElementById('modalForm').classList.add('hidden');
    document.getElementById('modalSuccess').classList.add('visible');

  } catch(err) {
    console.error(err);
    btn.textContent = 'Confirm Booking Request';
    btn.disabled = false;
    alert('Something went wrong. Please email chrishaircut07@gmail.com to book your appointment. Sorry for the inconvenience.');
  }
}

function updateTopnavExpandedState() {
  const topnav = document.querySelector('.topnav');
  if (!topnav) return;
  if (window.scrollY <= 0) {
    topnav.classList.add('top-expanded');
  } else {
    topnav.classList.remove('top-expanded');
  }
}

window.addEventListener('scroll', updateTopnavExpandedState);
window.addEventListener('load', updateTopnavExpandedState);