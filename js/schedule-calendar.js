/**
 * schedule-calendar.js -- Visual calendar date-range picker for menu schedule.
 * Works with hidden #schedule-start and #schedule-end inputs.
 */
(() => {
  const grid = document.getElementById('cal-grid');
  const label = document.getElementById('cal-month-label');
  const prevBtn = document.getElementById('cal-prev');
  const nextBtn = document.getElementById('cal-next');
  const clearBtn = document.getElementById('cal-clear-btn');
  const startInput = document.getElementById('schedule-start');
  const endInput = document.getElementById('schedule-end');
  const startDisplay = document.getElementById('range-start-display');
  const endDisplay = document.getElementById('range-end-display');

  if (!grid) return;

  let viewYear, viewMonth; // current calendar view
  let rangeStart = null;   // Date or null
  let rangeEnd = null;      // Date or null
  let pickingEnd = false;   // true after first click (picking end date)

  const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];

  function toDateStr(d) {
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function formatDisplay(d) {
    if (!d) return 'Not set';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function sameDay(a, b) {
    if (!a || !b) return false;
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  }

  function syncInputs() {
    startInput.value = toDateStr(rangeStart);
    endInput.value = toDateStr(rangeEnd);
    startDisplay.textContent = formatDisplay(rangeStart);
    endDisplay.textContent = formatDisplay(rangeEnd);
  }

  function render() {
    label.textContent = `${MONTHS[viewMonth]} ${viewYear}`;

    const firstDay = new Date(viewYear, viewMonth, 1);
    const startDow = firstDay.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const frag = document.createDocumentFragment();

    // Previous month trailing days
    for (let i = startDow - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const date = new Date(viewYear, viewMonth - 1, day);
      frag.appendChild(makeDay(day, date, true, today));
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewYear, viewMonth, d);
      frag.appendChild(makeDay(d, date, false, today));
    }

    // Next month leading days (fill to 42 cells = 6 rows)
    const totalCells = startDow + daysInMonth;
    const remaining = (totalCells % 7 === 0) ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remaining; d++) {
      const date = new Date(viewYear, viewMonth + 1, d);
      frag.appendChild(makeDay(d, date, true, today));
    }

    grid.textContent = '';
    grid.appendChild(frag);
  }

  function makeDay(dayNum, date, outside, today) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-day';
    btn.textContent = dayNum;

    if (outside) btn.classList.add('outside');
    if (sameDay(date, today)) btn.classList.add('today');

    // Range highlighting
    if (rangeStart && sameDay(date, rangeStart)) {
      btn.classList.add('range-start');
      if (!rangeEnd || sameDay(rangeStart, rangeEnd)) btn.classList.add('range-end');
    }
    if (rangeEnd && sameDay(date, rangeEnd)) {
      btn.classList.add('range-end');
    }
    if (rangeStart && rangeEnd && date > rangeStart && date < rangeEnd) {
      btn.classList.add('in-range');
    }

    btn.addEventListener('click', () => onDayClick(date));
    return btn;
  }

  function onDayClick(date) {
    if (!pickingEnd || !rangeStart) {
      // First click: set start
      rangeStart = date;
      rangeEnd = null;
      pickingEnd = true;
    } else {
      // Second click: set end
      if (date < rangeStart) {
        // Clicked before start -- swap
        rangeEnd = rangeStart;
        rangeStart = date;
      } else {
        rangeEnd = date;
      }
      pickingEnd = false;
    }
    syncInputs();
    render();
  }

  // Navigation
  prevBtn.addEventListener('click', () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    render();
  });
  nextBtn.addEventListener('click', () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    render();
  });

  // Clear
  clearBtn.addEventListener('click', () => {
    rangeStart = null;
    rangeEnd = null;
    pickingEnd = false;
    syncInputs();
    render();
  });

  // Initialize from existing input values
  function initFromInputs() {
    const sv = startInput.value;
    const ev = endInput.value;
    if (sv) {
      const parts = sv.split('-');
      rangeStart = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    }
    if (ev) {
      const parts = ev.split('-');
      rangeEnd = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    }
    // View the start date's month, or current month
    const ref = rangeStart || new Date();
    viewYear = ref.getFullYear();
    viewMonth = ref.getMonth();
    syncInputs();
    render();
  }

  // Expose init so admin.js can call it after loading schedule data
  window.initScheduleCalendar = initFromInputs;

  // Auto-init (will show current month if no data yet)
  initFromInputs();
})();
