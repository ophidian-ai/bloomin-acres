// The current posted menu is the only thing customers can order (site change
// #7). Christina manages it in Admin → Menu Editor: the items are in
// menu_sections/menu_items, and the ordering window is menu_schedule (id 1).
// The menu is open from start_date through the end of end_date, in Indiana
// time — the same rule menu.js uses to show or hide the menu.

const FARM_TZ = 'America/Indiana/Indianapolis';

// Today's date as YYYY-MM-DD in Indiana (servers run in UTC)
export function farmToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FARM_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function isMenuOpen(schedule, today = farmToday()) {
  if (!schedule) return true;
  if (schedule.start_date && today < schedule.start_date) return false;
  if (schedule.end_date && today > schedule.end_date) return false;
  return true;
}

export async function getActiveMenu(sb, now = new Date()) {
  const [{ data: schedule, error: schedErr }, { data: items, error: itemsErr }] = await Promise.all([
    sb.from('menu_schedule').select('start_date, end_date, message').eq('id', 1).maybeSingle(),
    sb.from('menu_items').select('stripe_product_id'),
  ]);
  if (schedErr) throw schedErr;
  if (itemsErr) throw itemsErr;
  return {
    open: isMenuOpen(schedule, farmToday(now)),
    message: schedule?.message || '',
    productIds: new Set((items || []).map(i => i.stripe_product_id).filter(Boolean)),
  };
}

// Checks a cart against the active menu. Returns null when every line can be
// ordered, otherwise { status, body } to send back. `off_menu` lists the
// product ids the page should drop from the cart before trying again.
export function menuProblem(menu, items) {
  if (!menu.open) {
    return {
      status: 409,
      body: {
        error: 'Ordering is closed right now — this week’s menu isn’t open.' + (menu.message ? ` ${menu.message}` : ''),
        menu_closed: true,
      },
    };
  }
  const offMenu = [...new Set(items.map(i => i.stripe_product_id).filter(id => !menu.productIds.has(id)))];
  if (offMenu.length) {
    return {
      status: 409,
      body: {
        error: offMenu.length === 1
          ? 'One item in your basket isn’t on this week’s menu, so it was removed. Please review your basket and check out again.'
          : `${offMenu.length} items in your basket aren’t on this week’s menu, so they were removed. Please review your basket and check out again.`,
        off_menu: offMenu,
      },
    };
  }
  return null;
}
