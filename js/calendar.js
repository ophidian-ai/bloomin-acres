/* ============================================================
   js/calendar.js — Bloomin' Acres Market Schedule Calendar
   Vanilla JS port of Point of Hope Church EventsSection
   ============================================================ */
(function () {
  'use strict';

  var FARMSTAND_ADDRESS = '3650 N State Road 9, Hope, IN 47246';
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  var today = new Date();
  var currentMonth = today.getMonth();
  var currentYear = today.getFullYear();
  var selectedDay = null;

  /* ── Event generator ──────────────────────────────────── */
  function getEventsForDate(date) {
    var events = [];
    var day = date.getDay(); // 0=Sun … 6=Sat

    // Tues, Wed, Thu — Farmstand Open 10a–6p
    if (day >= 2 && day <= 4) {
      events.push({
        name: 'Farmstand Open',
        startTime: '10:00 AM',
        endTime: '6:00 PM',
        description: 'Stop by for fresh sourdough, seasonal produce, and baked goods straight from our kitchen and garden.',
        color: 'sage',
      });
    }

    // Friday — shorter hours 2p–6p
    if (day === 5) {
      events.push({
        name: 'Friday Hours',
        startTime: '2:00 PM',
        endTime: '6:00 PM',
        description: 'We open a little later on Fridays — swing by after lunch for fresh bread and weekend provisions.',
        color: 'wheat',
      });
    }

    // Saturday — Market Day 4p–6p (market season: Apr–Oct)
    if (day === 6) {
      var month = date.getMonth();
      if (month >= 3 && month <= 9) {
        events.push({
          name: 'Market Day',
          startTime: '4:00 PM',
          endTime: '6:00 PM',
          description: 'Saturday market hours during growing season. Grab the best of the week before it\'s gone!',
          color: 'orange',
        });
      }
    }

    return events;
  }

  /* ── Google Calendar URL builder ───────────────────────── */
  function googleCalendarUrl(date, event) {
    function pad(n) { return String(n).padStart(2, '0'); }
    function parseTime(str) {
      var parts = str.split(' ');
      var hm = parts[0].split(':');
      var h = parseInt(hm[0], 10);
      var m = parseInt(hm[1], 10);
      if (parts[1] === 'PM' && h !== 12) h += 12;
      if (parts[1] === 'AM' && h === 12) h = 0;
      return { h: h, m: m };
    }
    var s = parseTime(event.startTime);
    var e = parseTime(event.endTime);
    var y = date.getFullYear();
    var mo = pad(date.getMonth() + 1);
    var d = pad(date.getDate());
    var dtStart = y + mo + d + 'T' + pad(s.h) + pad(s.m) + '00';
    var dtEnd   = y + mo + d + 'T' + pad(e.h) + pad(e.m) + '00';
    var params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.name + ' — Bloomin\' Acres',
      dates: dtStart + '/' + dtEnd,
      details: event.description,
      location: FARMSTAND_ADDRESS,
      ctz: 'America/Indiana/Indianapolis',
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  /* ── Color helpers ────────────────────────────────────── */
  function dotClass(color) { return 'cal-dot cal-dot-' + color; }
  function badgeClass(color) { return 'cal-event-badge cal-badge-' + color; }

  /* ── DOM references ───────────────────────────────────── */
  var monthLabel = document.getElementById('cal-month-label');
  var grid = document.getElementById('cal-grid');
  var gridWrap = document.getElementById('cal-grid-wrap');
  var mobileList = document.getElementById('cal-mobile-list');
  var eventDetail = document.getElementById('cal-event-detail');
  var prevBtn = document.getElementById('cal-prev');
  var nextBtn = document.getElementById('cal-next');

  if (!monthLabel || !grid) return; // calendar section not on page

  /* ── Render month label ───────────────────────────────── */
  function updateLabel() {
    var d = new Date(currentYear, currentMonth);
    monthLabel.textContent = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  /* ── Render desktop grid ──────────────────────────────── */
  function renderGrid() {
    grid.textContent = '';
    var firstDay = new Date(currentYear, currentMonth, 1).getDay();
    var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    // Empty cells before first day
    for (var i = 0; i < firstDay; i++) {
      var empty = document.createElement('div');
      empty.className = 'cal-cell cal-cell-empty';
      grid.appendChild(empty);
    }

    for (var d = 1; d <= daysInMonth; d++) {
      var date = new Date(currentYear, currentMonth, d);
      var events = getEventsForDate(date);
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-cell';
      if (events.length > 0) cell.classList.add('cal-cell-has-events');
      if (d === selectedDay) cell.classList.add('cal-cell-selected');

      // Day number
      var numEl = document.createElement('span');
      numEl.className = 'cal-day-num';
      if (today.getFullYear() === currentYear && today.getMonth() === currentMonth && today.getDate() === d) {
        numEl.classList.add('cal-day-today');
      }
      numEl.textContent = d;
      cell.appendChild(numEl);

      // Event dots
      if (events.length > 0) {
        var dotsWrap = document.createElement('div');
        dotsWrap.className = 'cal-dots';
        events.forEach(function (ev) {
          var dot = document.createElement('span');
          dot.className = dotClass(ev.color);
          dot.title = ev.name;
          dotsWrap.appendChild(dot);
        });
        cell.appendChild(dotsWrap);
      }

      // Click handler
      (function (day) {
        cell.addEventListener('click', function () {
          if (getEventsForDate(new Date(currentYear, currentMonth, day)).length === 0) return;
          selectedDay = selectedDay === day ? null : day;
          renderGrid();
          renderEventDetail();
        });
      })(d);

      grid.appendChild(cell);
    }

    // Pad remaining cells to complete row
    var totalCells = firstDay + daysInMonth;
    var remainder = totalCells % 7;
    if (remainder > 0) {
      for (var j = 0; j < 7 - remainder; j++) {
        var pad = document.createElement('div');
        pad.className = 'cal-cell cal-cell-empty';
        grid.appendChild(pad);
      }
    }
  }

  /* ── Render event detail cards ─────────────────────────── */
  function renderEventDetail() {
    eventDetail.textContent = '';
    if (selectedDay === null) {
      eventDetail.classList.add('cal-hidden');
      return;
    }
    var date = new Date(currentYear, currentMonth, selectedDay);
    var events = getEventsForDate(date);
    if (events.length === 0) {
      eventDetail.classList.add('cal-hidden');
      return;
    }
    eventDetail.classList.remove('cal-hidden');

    events.forEach(function (ev) {
      var card = document.createElement('div');
      card.className = 'cal-event-card';

      // Close button
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'cal-event-close';
      closeBtn.setAttribute('aria-label', 'Close');
      var closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      closeIcon.setAttribute('width', '16');
      closeIcon.setAttribute('height', '16');
      closeIcon.setAttribute('viewBox', '0 0 24 24');
      closeIcon.setAttribute('fill', 'none');
      closeIcon.setAttribute('stroke', 'currentColor');
      closeIcon.setAttribute('stroke-width', '2');
      closeIcon.setAttribute('stroke-linecap', 'round');
      var line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line1.setAttribute('x1', '18'); line1.setAttribute('y1', '6');
      line1.setAttribute('x2', '6');  line1.setAttribute('y2', '18');
      var line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line2.setAttribute('x1', '6');  line2.setAttribute('y1', '6');
      line2.setAttribute('x2', '18'); line2.setAttribute('y2', '18');
      closeIcon.append(line1, line2);
      closeBtn.appendChild(closeIcon);
      closeBtn.addEventListener('click', function () {
        selectedDay = null;
        renderGrid();
        renderEventDetail();
      });
      card.appendChild(closeBtn);

      // Badge
      var badge = document.createElement('div');
      badge.className = badgeClass(ev.color);
      badge.textContent = ev.name;
      card.appendChild(badge);

      // Meta (time + location)
      var meta = document.createElement('div');
      meta.className = 'cal-event-meta';

      var timeRow = document.createElement('div');
      timeRow.className = 'cal-event-meta-row';
      var clockSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      clockSvg.setAttribute('width', '14'); clockSvg.setAttribute('height', '14');
      clockSvg.setAttribute('viewBox', '0 0 24 24'); clockSvg.setAttribute('fill', 'none');
      clockSvg.setAttribute('stroke', 'currentColor'); clockSvg.setAttribute('stroke-width', '2');
      var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '10');
      var hand1 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      hand1.setAttribute('points', '12 6 12 12 16 14');
      clockSvg.append(circle, hand1);
      var timeText = document.createElement('span');
      timeText.textContent = ev.startTime + ' \u2013 ' + ev.endTime;
      timeRow.append(clockSvg, timeText);

      var locRow = document.createElement('div');
      locRow.className = 'cal-event-meta-row';
      var pinSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      pinSvg.setAttribute('width', '14'); pinSvg.setAttribute('height', '14');
      pinSvg.setAttribute('viewBox', '0 0 24 24'); pinSvg.setAttribute('fill', 'none');
      pinSvg.setAttribute('stroke', 'currentColor'); pinSvg.setAttribute('stroke-width', '2');
      var path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path1.setAttribute('d', 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z');
      var pinCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      pinCircle.setAttribute('cx', '12'); pinCircle.setAttribute('cy', '10'); pinCircle.setAttribute('r', '3');
      pinSvg.append(path1, pinCircle);
      var locText = document.createElement('span');
      locText.textContent = FARMSTAND_ADDRESS;
      locRow.append(pinSvg, locText);

      meta.append(timeRow, locRow);
      card.appendChild(meta);

      // Description
      var desc = document.createElement('p');
      desc.className = 'cal-event-desc';
      desc.textContent = ev.description;
      card.appendChild(desc);

      // Add to Google Calendar link
      var gcalLink = document.createElement('a');
      gcalLink.className = 'cal-event-gcal';
      gcalLink.href = googleCalendarUrl(date, ev);
      gcalLink.target = '_blank';
      gcalLink.rel = 'noopener noreferrer';
      var calSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      calSvg.setAttribute('width', '13'); calSvg.setAttribute('height', '13');
      calSvg.setAttribute('viewBox', '0 0 24 24'); calSvg.setAttribute('fill', 'none');
      calSvg.setAttribute('stroke', 'currentColor'); calSvg.setAttribute('stroke-width', '2');
      var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', '3'); rect.setAttribute('y', '4');
      rect.setAttribute('width', '18'); rect.setAttribute('height', '18');
      rect.setAttribute('rx', '2');
      var calLine1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      calLine1.setAttribute('x1', '16'); calLine1.setAttribute('y1', '2');
      calLine1.setAttribute('x2', '16'); calLine1.setAttribute('y2', '6');
      var calLine2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      calLine2.setAttribute('x1', '8'); calLine2.setAttribute('y1', '2');
      calLine2.setAttribute('x2', '8'); calLine2.setAttribute('y2', '6');
      var calLine3 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      calLine3.setAttribute('x1', '3'); calLine3.setAttribute('y1', '10');
      calLine3.setAttribute('x2', '21'); calLine3.setAttribute('y2', '10');
      calSvg.append(rect, calLine1, calLine2, calLine3);
      gcalLink.appendChild(calSvg);
      gcalLink.append(' Add to Calendar');
      card.appendChild(gcalLink);

      eventDetail.appendChild(card);
    });
  }

  /* ── Render mobile list ───────────────────────────────── */
  function renderMobileList() {
    mobileList.textContent = '';
    var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    var hasDays = false;
    for (var d = 1; d <= daysInMonth; d++) {
      var date = new Date(currentYear, currentMonth, d);
      var events = getEventsForDate(date);
      if (events.length === 0) continue;
      hasDays = true;

      var dayEl = document.createElement('div');
      dayEl.className = 'cal-mobile-day';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-mobile-day-btn';

      var dots = document.createElement('div');
      dots.className = 'cal-mobile-day-dots';
      events.forEach(function (ev) {
        var dot = document.createElement('span');
        dot.className = dotClass(ev.color);
        dots.appendChild(dot);
      });

      var label = document.createElement('span');
      label.className = 'cal-mobile-day-label';
      label.textContent = date.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      });

      var count = document.createElement('span');
      count.className = 'cal-mobile-day-count';
      count.textContent = events.length + ' event' + (events.length > 1 ? 's' : '');

      btn.append(dots, label, count);
      dayEl.appendChild(btn);

      // Expandable events
      var eventsWrap = document.createElement('div');
      eventsWrap.className = 'cal-mobile-events';

      events.forEach(function (ev) {
        var badge = document.createElement('div');
        badge.className = badgeClass(ev.color);
        badge.textContent = ev.name;
        eventsWrap.appendChild(badge);

        var timeLine = document.createElement('div');
        timeLine.className = 'cal-event-meta-row';
        timeLine.style.marginTop = '.35rem';
        timeLine.style.fontSize = '.82rem';
        timeLine.style.color = '#6B4C35';
        timeLine.textContent = ev.startTime + ' \u2013 ' + ev.endTime;
        eventsWrap.appendChild(timeLine);

        var descP = document.createElement('p');
        descP.className = 'cal-event-desc';
        descP.style.marginTop = '.25rem';
        descP.textContent = ev.description;
        eventsWrap.appendChild(descP);

        var gcal = document.createElement('a');
        gcal.className = 'cal-event-gcal';
        gcal.style.marginTop = '.5rem';
        gcal.style.marginBottom = '.75rem';
        gcal.href = googleCalendarUrl(date, ev);
        gcal.target = '_blank';
        gcal.rel = 'noopener noreferrer';
        gcal.textContent = 'Add to Calendar';
        eventsWrap.appendChild(gcal);
      });

      dayEl.appendChild(eventsWrap);

      // Toggle accordion
      btn.addEventListener('click', (function (el) {
        return function () { el.classList.toggle('open'); };
      })(dayEl));

      mobileList.appendChild(dayEl);
    }

    if (!hasDays) {
      var none = document.createElement('p');
      none.style.textAlign = 'center';
      none.style.padding = '2rem 0';
      none.style.color = '#6B4C35';
      none.style.fontStyle = 'italic';
      none.textContent = 'No market days this month.';
      mobileList.appendChild(none);
    }
  }

  /* ── Full render ──────────────────────────────────────── */
  function render() {
    updateLabel();
    selectedDay = null;
    renderGrid();
    renderEventDetail();
    renderMobileList();
  }

  /* ── Month navigation ─────────────────────────────────── */
  prevBtn.addEventListener('click', function () {
    var d = new Date(currentYear, currentMonth - 1, 1);
    currentMonth = d.getMonth();
    currentYear = d.getFullYear();
    render();
  });
  nextBtn.addEventListener('click', function () {
    var d = new Date(currentYear, currentMonth + 1, 1);
    currentMonth = d.getMonth();
    currentYear = d.getFullYear();
    render();
  });

  /* ── Initial render ───────────────────────────────────── */
  render();
})();
