import React, { useEffect, useRef, useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { FaCalendarAlt, FaChevronUp, FaChevronDown } from "react-icons/fa";
import {
  formatDisplayDateMMDDYYYY,
  parseMMDDYYYYToIso,
} from "../utils/complianceDeadlineReminders";

function isoToDate(iso) {
  if (!iso) return null;
  const parts = String(iso).trim().split("-");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const dt = new Date(year, month, day);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function dateToIso(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const ComplianceDeadlineInput = ({ value, onChange, disabled, className = "" }) => {
  const [text, setText] = useState(() => formatDisplayDateMMDDYYYY(value));
  const [showCalendar, setShowCalendar] = useState(false);
  const [activeStartDate, setActiveStartDate] = useState(
    () => isoToDate(value) || startOfLocalDay(),
  );
  const containerRef = useRef(null);

  useEffect(() => {
    setText(formatDisplayDateMMDDYYYY(value));
    const parsed = isoToDate(value);
    if (parsed) setActiveStartDate(parsed);
  }, [value]);

  useEffect(() => {
    if (!showCalendar) return undefined;

    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowCalendar(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showCalendar]);

  const openCalendar = () => {
    if (disabled) return;
    setActiveStartDate(isoToDate(value) || startOfLocalDay());
    setShowCalendar(true);
  };

  const commit = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      onChange("");
      setText("");
      return;
    }
    const iso = parseMMDDYYYYToIso(trimmed);
    if (iso) {
      onChange(iso);
      setText(formatDisplayDateMMDDYYYY(iso));
      return;
    }
    setText(formatDisplayDateMMDDYYYY(value));
  };

  const applyDate = (date) => {
    const iso = dateToIso(date);
    onChange(iso);
    setText(formatDisplayDateMMDDYYYY(iso));
    setShowCalendar(false);
  };

  const handleCalendarChange = (date) => {
    applyDate(date);
  };

  const handleClear = () => {
    onChange("");
    setText("");
    setShowCalendar(false);
  };

  const handleToday = () => {
    applyDate(startOfLocalDay());
  };

  const shiftMonth = (delta) => {
    setActiveStartDate(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1),
    );
  };

  const selectedDate = isoToDate(value);
  const inputClassName =
    className ||
    "block w-full rounded-md border-gray-300 shadow-sm text-sm focus:border-blue-700 focus:ring-blue-700 disabled:bg-gray-100";

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={openCalendar}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              setShowCalendar(false);
            }
          }}
          disabled={disabled}
          placeholder="MM/DD/YYYY"
          title="Enter date as MM/DD/YYYY or pick from calendar"
          className={`${inputClassName} flex-1 min-w-0`}
        />
        <button
          type="button"
          onClick={() => (showCalendar ? setShowCalendar(false) : openCalendar())}
          disabled={disabled}
          title="Open calendar"
          aria-label="Open calendar"
          className="inline-flex shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white px-3 text-gray-600 shadow-sm hover:bg-gray-50 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
        >
          <FaCalendarAlt className="h-4 w-4" />
        </button>
      </div>

      {showCalendar && !disabled ? (
        <div className="compliance-datepicker absolute left-0 top-full z-[70] mt-2 w-[280px] rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-sm font-semibold text-gray-800">
              {activeStartDate.toLocaleString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </span>
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                aria-label="Previous month"
              >
                <FaChevronUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                aria-label="Next month"
              >
                <FaChevronDown className="h-3 w-3" />
              </button>
            </div>
          </div>

          <Calendar
            onChange={handleCalendarChange}
            value={selectedDate}
            activeStartDate={activeStartDate}
            onActiveStartDateChange={({ activeStartDate: next }) => {
              if (next) setActiveStartDate(next);
            }}
            calendarType="iso8601"
            showNeighboringMonth
            next2Label={null}
            prev2Label={null}
            formatShortWeekday={(_locale, date) =>
              date.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2)
            }
            tileClassName={({ date, view }) => {
              if (view !== "month") return null;
              const today = startOfLocalDay();
              const isToday =
                date.getFullYear() === today.getFullYear() &&
                date.getMonth() === today.getMonth() &&
                date.getDate() === today.getDate();
              return isToday ? "compliance-datepicker-today" : null;
            }}
            className="compliance-datepicker-calendar border-none"
          />

          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
            <button
              type="button"
              onClick={handleClear}
              className="text-sm font-medium text-blue-600 hover:text-blue-800"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="text-sm font-medium text-blue-600 hover:text-blue-800"
            >
              Today
            </button>
          </div>
        </div>
      ) : null}

      <style>{`
        .compliance-datepicker .react-calendar {
          width: 100%;
          border: none;
          font-family: inherit;
          background: transparent;
        }
        .compliance-datepicker .react-calendar__navigation {
          display: none;
        }
        .compliance-datepicker .react-calendar__month-view__weekdays {
          text-align: center;
          text-transform: none;
          font-weight: 500;
          font-size: 12px;
          color: #6b7280;
        }
        .compliance-datepicker .react-calendar__month-view__weekdays__weekday {
          padding: 0.35rem 0;
        }
        .compliance-datepicker .react-calendar__month-view__weekdays__weekday abbr {
          text-decoration: none;
        }
        .compliance-datepicker .react-calendar__tile {
          padding: 0.55rem 0;
          font-size: 13px;
          border-radius: 4px;
          color: #111827;
        }
        .compliance-datepicker .react-calendar__month-view__days__day--neighboringMonth {
          color: #9ca3af;
        }
        .compliance-datepicker .react-calendar__tile:enabled:hover {
          background: #eff6ff;
        }
        .compliance-datepicker .react-calendar__tile--active,
        .compliance-datepicker .react-calendar__tile--active:enabled:hover,
        .compliance-datepicker .react-calendar__tile--active:enabled:focus {
          background: #1677ff !important;
          color: #fff !important;
          border-radius: 4px;
        }
        .compliance-datepicker .compliance-datepicker-today {
          box-shadow: inset 0 0 0 1px #1677ff;
        }
        .compliance-datepicker .react-calendar__tile--active.compliance-datepicker-today {
          box-shadow: none;
        }
      `}</style>
    </div>
  );
};

export default ComplianceDeadlineInput;
