/* ============================================================
   js/calendar.js — Bloomin' Acres Market Schedule Calendar
   Fetches events from Christina's Google Calendar via /api/calendar
   ============================================================ */
(function () {
  'use strict';

  var FARMSTAND_ADDRESS = '3650 N State Road 9, Hope, IN 47246';

  var today = new Date();
  var currentMonth = today.getMonth();
  var currentYear = today.getFullYear();
  var selectedDay = null;
  var eventsCache = {}; // keyed by 'YYYY-M' → { dayNum: [event, …] }

  /* ── Google Calendar color ID → brand color ─────────── */
  var COLOR_MAP = {
    '2': 'sage', '10': 'sage',       // Sage, Basil
    '5': 'wheat', '6': 'wheat',      // Banana, Tangerine
    '4': 'orange', '11': 'orange',   // Flamingo, Tomato
  };
  function mapColor(colorId) {
    return COLOR_MAP[colorId] || 'sage';
  }

  /* ── Time formatting ────────────────────────────────── */
  function formatTime(isoStr) {
    var d = new Date(isoStr);
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + String(m).padStart(2, '0') + ' ' + ampm;
  }

  /* ── Google Calendar URL builder ───────────────────── */
  function googleCalendarUrl(event) {
    function pad(n) { return String(n).padStart(2, '0'); }

    if (event.allDay) {
      var sd = new Date(event.startDate + 'T00:00:00');
      var ed = new Date(event.endDate + 'T00:00:00');
      var dtStart = sd.getFullYear() + pad(sd.getMonth() + 1) + pad(sd.getDate());
      var dtEnd = ed.getFullYear() + pad(ed.getMonth() + 1) + pad(ed.getDate());
    } else {
      var s = new Date(event.startDate);
      var e = new Date(event.endDate);
      var dtStart = s.getFullYear() + pad(s.getMonth() + 1) + pad(s.getDate()) +
        'T' + pad(s.getHours()) + pad(s.getMinutes()) + '00';
      var dtEnd = e.getFullYear() + pad(e.getMonth() + 1) + pad(e.getDate()) +
        'T' + pad(e.getHours()) + pad(e.getMinutes()) + '00';
    }

    var params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.name + ' \u2014 Bloomin\' Acres',
      dates: dtStart + '/' + dtEnd,
      details: event.description || '',
      location: event.location || FARMSTAND_ADDRESS,
      ctz: 'America/Indiana/Indianapolis',
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  /* ── Color helpers ──────────────────────────────────── */
  function dotClass(color) { return 'cal-dot cal-dot-' + color; }
  function badgeClass(color) { return 'cal-event-badge cal-badge-' + color; }

  /* ── DOM references ─────────────────────────────────── */
  var monthLabel = document.getElementById('cal-month-label');
  var grid = document.getElementById('cal-grid');
  var gridWrap = document.getElementById('cal-grid-wrap');
  var mobileList = document.getElementById('cal-mobile-list');
  var eventDetail = document.getElementById('cal-event-detail');
  var prevBtn = document.getElementById('cal-prev');
  var nextBtn = document.getElementById('cal-next');

  if (!monthLabel || !grid) return;

  /* ── Fetch events from API ──────────────────────────── */
  function fetchEvents(year, month, callback) {
    var cacheKey = year + '-' + month;
    if (eventsCache[cacheKey]) {
      callback(eventsCache[cacheKey]);
      return;
    }

    fetch('/api/calendar?year=' + year + '&month=' + month)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var byDay = {};
        (data.events || []).forEach(function (ev) {
          var dateStr = ev.allDay ? ev.startDate : ev.startDate;
          var d = new Date(dateStr);
          var dayNum = d.getDate();
          // Only include events that actually fall in the requested month
          if (d.getMonth() !== month || d.getFullYear() !== year) return;
          if (!byDay[dayNum]) byDay[dayNum] = [];
          byDay[dayNum].push({
            name: ev.name,
            startTime: ev.allDay ? 'All Day' : formatTime(ev.startDate),
            endTime: ev.allDay ? '' : formatTime(ev.endDate),
            description: ev.description,
            location: ev.location,
            color: mapColor(ev.color),
            allDay: ev.allDay,
            startDate: ev.startDate,
            endDate: ev.endDate,
          });
        });
        eventsCache[cacheKey] = byDay;
        callback(byDay);
      })
      .catch(function () {
        callback({});
      });
  }

  /* ── Get events for a day from cache ────────────────── */
  function getEventsForDay(dayNum) {
    var cacheKey = currentYear + '-' + currentMonth;
    var byDay = eventsCache[cacheKey] || {};
    return byDay[dayNum] || [];
  }

  /* ── Render month label ─────────────────────────────── */
  function updateLabel() {
    var d = new Date(currentYear, currentMonth);
    monthLabel.textContent = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  /* ── Render desktop grid ────────────────────────────── */
  function renderGrid() {
    grid.textContent = '';
    var firstDay = new Date(currentYear, currentMonth, 1).getDay();
    var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    for (var i = 0; i < firstDay; i++) {
      var empty = document.createElement('div');
      empty.className = 'cal-cell cal-cell-empty';
      grid.appendChild(empty);
    }

    for (var d = 1; d <= daysInMonth; d++) {
      var events = getEventsForDay(d);
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-cell';
      if (events.length > 0) cell.classList.add('cal-cell-has-events');
      if (d === selectedDay) cell.classList.add('cal-cell-selected');

      var numEl = document.createElement('span');
      numEl.className = 'cal-day-num';
      if (today.getFullYear() === currentYear && today.getMonth() === currentMonth && today.getDate() === d) {
        numEl.classList.add('cal-day-today');
      }
      numEl.textContent = d;
      cell.appendChild(numEl);

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

      (function (day) {
        cell.addEventListener('click', function () {
          if (getEventsForDay(day).length === 0) return;
          selectedDay = selectedDay === day ? null : day;
          renderGrid();
          renderEventDetail();
        });
      })(d);

      grid.appendChild(cell);
    }

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

  /* ── Render event detail cards ──────────────────────── */
  function renderEventDetail() {
    eventDetail.textContent = '';
    if (selectedDay === null) {
      eventDetail.classList.add('cal-hidden');
      return;
    }
    var events = getEventsForDay(selectedDay);
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
      timeText.textContent = ev.allDay ? 'All Day' : (ev.startTime + ' \u2013 ' + ev.endTime);
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
      locText.textContent = ev.location || FARMSTAND_ADDRESS;
      locRow.append(pinSvg, locText);

      meta.append(timeRow, locRow);
      card.appendChild(meta);

      // Description
      if (ev.description) {
        var desc = document.createElement('p');
        desc.className = 'cal-event-desc';
        desc.textContent = ev.description;
        card.appendChild(desc);
      }

      // Add to Google Calendar link
      var gcalLink = document.createElement('a');
      gcalLink.className = 'cal-event-gcal';
      gcalLink.href = googleCalendarUrl(ev);
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

  /* ── Render mobile list ─────────────────────────────── */
  function renderMobileList() {
    mobileList.textContent = '';
    var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    var hasDays = false;
    for (var d = 1; d <= daysInMonth; d++) {
      var events = getEventsForDay(d);
      if (events.length === 0) continue;
      hasDays = true;

      var date = new Date(currentYear, currentMonth, d);
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
        timeLine.textContent = ev.allDay ? 'All Day' : (ev.startTime + ' \u2013 ' + ev.endTime);
        eventsWrap.appendChild(timeLine);

        if (ev.description) {
          var descP = document.createElement('p');
          descP.className = 'cal-event-desc';
          descP.style.marginTop = '.25rem';
          descP.textContent = ev.description;
          eventsWrap.appendChild(descP);
        }

        var gcal = document.createElement('a');
        gcal.className = 'cal-event-gcal';
        gcal.style.marginTop = '.5rem';
        gcal.style.marginBottom = '.75rem';
        gcal.href = googleCalendarUrl(ev);
        gcal.target = '_blank';
        gcal.rel = 'noopener noreferrer';
        gcal.textContent = 'Add to Calendar';
        eventsWrap.appendChild(gcal);
      });

      dayEl.appendChild(eventsWrap);

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
      none.textContent = 'No events this month.';
      mobileList.appendChild(none);
    }
  }

  /* ── Full render (fetch then draw) ──────────────────── */
  function render() {
    updateLabel();
    selectedDay = null;
    fetchEvents(currentYear, currentMonth, function () {
      renderGrid();
      renderEventDetail();
      renderMobileList();
    });
  }

  /* ── Month navigation ───────────────────────────────── */
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

  /* ── Initial render ─────────────────────────────────── */
  render();
})();
