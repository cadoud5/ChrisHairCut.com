// Highlight today in hours table
  const dayMap = ['sun','mon','tue','wed','thu','fri','sat'];
  const todayKey = dayMap[new Date().getDay()];
  const row = document.getElementById('row-' + todayKey);
  if (row) row.classList.add('today');

  // Set min date
  const d = new Date();
  const dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  document.getElementById('m-date').min = dateStr;

  // Tabs
  function switchTab(tab) {
    document.getElementById('tab-services').classList.toggle('active', tab === 'services');
    document.getElementById('tab-staff').classList.toggle('active', tab === 'staff');
    document.getElementById('panel-services').classList.toggle('hidden', tab !== 'services');
    document.getElementById('panel-staff').classList.toggle('visible', tab === 'staff');
  }

  // Modal
  function openModal(service) {
    document.getElementById('modalOverlay').classList.add('open');
    document.getElementById('modalForm').classList.remove('hidden');
    document.getElementById('modalSuccess').classList.remove('visible');
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
const EMAILJS_PUBLIC_KEY   = 'gX15PgeZlIn8eiMX0';
const EMAILJS_SERVICE_ID   = 'service_gb4dubg';
const OWNER_TEMPLATE_ID    = 'template_gmmwedq';
const CUSTOMER_TEMPLATE_ID = 'template_jm9dz3w';

emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });

async function submitForm(e) {
  e.preventDefault();

  const btn = document.getElementById('submitBtn');
  btn.textContent = 'Sending…';
  btn.disabled = true;

  const prices = {
  'Mens Haircut — $17.00 · 30 min': '$17.00',
  'Buzzcut — $10.00 · 30 min': '$10.00',
  'UIC Student — $13.00 · 30 min': '$13.00',
};

  const p = {
    customer_name:  document.getElementById('m-fname').value.trim() + ' ' +
                    document.getElementById('m-lname').value.trim(),
    customer_phone: document.getElementById('m-phone').value.trim(),
    customer_email: document.getElementById('m-email').value.trim(),
    from_email:     'chrishaircut07@gmail.com',
    to_email:       document.getElementById('m-email').value.trim(),
    service:        document.getElementById('m-service').value,
    price:          prices[document.getElementById('m-service').value] || 'N/A',
    date:           document.getElementById('m-date').value,
    time:           document.getElementById('m-time').value,
    notes:          document.getElementById('m-notes').value.trim() || 'None',
  };

  try {
    await emailjs.send(EMAILJS_SERVICE_ID, OWNER_TEMPLATE_ID, p);
    p.to_email = 'chrishaircut07@gmail.com';
    p.from_email = document.getElementById('m-email').value.trim();
    await emailjs.send(EMAILJS_SERVICE_ID, OWNER_TEMPLATE_ID, p);
    document.getElementById('modalForm').classList.add('hidden');
    document.getElementById('modalSuccess').classList.add('visible');
  } catch(err) {
    console.error(err);
    btn.textContent = 'Confirm Booking Request';
    btn.disabled = false;
    alert('Something went wrong. Please call 773.314.0148.');
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
