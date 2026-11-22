import { differenceInCalendarDays, format, getISOWeek, lastDayOfYear } from 'date-fns';
import { useNow } from './useNow.ts';
import './TimePanel.css';

/**
 * The hero's head, set in day ink on the pale fog: today's date, a live
 * 24-hour clock and where the year stands. Uses the system time zone.
 */
export function TimePanel() {
  const now = useNow(1000);
  const daysLeft = differenceInCalendarDays(lastDayOfYear(now), now);

  return (
    <div className="time">
      <h1 className="time__date">{format(now, 'EEEE, d MMMM')}</h1>
      <p className="time__clock num" aria-live="off">
        <time dateTime={now.toISOString()}>{format(now, 'HH:mm:ss')}</time>
      </p>
      <p className="time__year num">
        {`Week ${getISOWeek(now)} · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left in ${now.getFullYear()}`}
      </p>
    </div>
  );
}
