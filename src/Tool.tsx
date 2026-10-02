// Suncatch: a day-by-day jet lag plan built from real flight times and your usual sleep.
import { useMemo } from "react";
import { useStored } from "./lib/store";
import { ALL_ZONES, addDays, hhmm, mod24, offsetLabel, prettyDate, toHours, todayISO, tzOffset, zonedToDate, zoneLabel } from "./lib/time";
import { DayBar, DayBarLegend, type Seg } from "./ui/DayBar";

const T = "suncatch";

type Day = { label: string; date: string; segs: Seg[]; notes: string[]; phase: "before" | "flight" | "after" };

export default function Suncatch() {
  const [from, setFrom] = useStored(T, "from", "Africa/Tunis");
  const [to, setTo] = useStored(T, "to", "Asia/Tokyo");
  const [depDate, setDepDate] = useStored(T, "depDate", addDays(todayISO(), 10));
  const [depTime, setDepTime] = useStored(T, "depTime", "13:40");
  const [flightH, setFlightH] = useStored(T, "flightH", 15);
  const [sleep, setSleep] = useStored(T, "sleep", "23:00");
  const [wake, setWake] = useStored(T, "wake", "07:00");
  const [prep, setPrep] = useStored(T, "prep", true);

  const plan = useMemo(() => {
    const dep = zonedToDate(depDate, depTime, from);
    const arr = new Date(dep.getTime() + flightH * 3600000);
    const shiftMin = tzOffset(to, arr) - tzOffset(from, dep);
    let shift = shiftMin / 60;
    if (shift > 12) shift -= 24;
    if (shift < -12) shift += 24;
    const east = shift > 0;
    const abs = Math.abs(shift);
    const rate = east ? 1 : 1.5; // the body clock delays more easily than it advances
    const S = toHours(sleep), Wk = toHours(wake);
    const sleepLen = mod24(Wk - S) || 8;
    const arrLocalH = mod24(arr.getUTCHours() + arr.getUTCMinutes() / 60 + tzOffset(to, arr) / 60);
    const arrDate = new Date(arr.getTime() + tzOffset(to, arr) * 60000).toISOString().slice(0, 10);
    const days: Day[] = [];
    const sign = east ? 1 : -1;

    if (abs < 3) return { shift, east, abs, daysToAdapt: 0, days, dep, arr, arrLocalH, small: true };

    // Before departure: shift sleep up to 1 hour per day toward the destination, in home time.
    const prepDays = prep ? Math.min(3, Math.floor(abs)) : 0;
    const left = abs - prepDays; // hours still to shift after landing
    const daysToAdapt = Math.ceil(left / rate);
    // Keep advice inside waking hours: nobody should be told to find daylight at 03:00.
    const awakeEnd = Wk + 24 - sleepLen;
    const clip = (a: number, b: number): [number, number] | null => {
      const len = b - a;
      for (const base of [Wk + mod24(a - Wk), Wk + mod24(a - Wk) - 24]) {
        const lo = Math.max(base, Wk), hi = Math.min(base + len, awakeEnd);
        if (hi - lo >= 0.5) return [lo, hi];
      }
      return null;
    };
    for (let d = prepDays; d >= 1; d--) {
      const moved = (prepDays - d + 1) * 1;
      const s = S - sign * moved, w = s + sleepLen;
      const cbt = w - 3;
      days.push({
        phase: "before", date: addDays(depDate, -d), label: `${d} ${d === 1 ? "day" : "days"} before`,
        segs: [{ start: s, end: w, kind: "sleep" }, east ? { start: cbt, end: cbt + 3, kind: "light" } : { start: cbt - 3, end: cbt, kind: "light" }, { start: s - 6, end: s - 6, kind: "caffeine" }],
        notes: [`Go to bed at ${hhmm(s)} and get up at ${hhmm(w)} (home time).`, east ? "Get bright light soon after waking." : "Get bright light in the evening before bed."],
      });
    }

    // Flight day guidance, in destination time.
    const bedDest = S, wakeDest = Wk;
    const inWindow = (h: number) => (bedDest < wakeDest ? h >= bedDest && h < wakeDest : h >= bedDest || h < wakeDest);
    const arrivesAtNight = inWindow(arrLocalH);
    days.push({
      phase: "flight", date: depDate, label: "Flight day",
      segs: [], notes: [
        `Set your watch to ${zoneLabel(to)} time when you board.`,
        `You land at ${hhmm(arrLocalH)} local time on ${prettyDate(arrDate)}.`,
        arrivesAtNight ? "You land during the night there, so stay awake for the last hours of the flight and sleep soon after arrival." :
          arrLocalH < 12 ? "You land in the morning, so sleep as much as you can on the flight and stay up until evening." :
            "You land in the afternoon or evening, so take only short naps on the flight and go to bed at a normal local time.",
        "Drink water, go easy on alcohol, and skip caffeine in the 6 hours before you plan to sleep.",
      ],
    });

    // After arrival: body clock catches up by `rate` hours a day. Light timing follows the body clock's temperature low.
    for (let d = 0; d <= daysToAdapt; d++) {
      const remaining = Math.max(0, left - rate * d) * sign; // how far the body still lags, in hours
      const cbt = mod24(Wk - 3 + remaining); // body temperature low, in destination clock
      const segs: Seg[] = [{ start: bedDest, end: bedDest + sleepLen, kind: "sleep" }, { start: bedDest - 6, end: bedDest - 6, kind: "caffeine" }];
      const notes: string[] = [];
      if (Math.abs(remaining) >= 1) {
        const [lightA, darkA] = east ? [cbt, cbt - 3] : [cbt - 3, cbt];
        const light = clip(lightA, lightA + 3), dark = clip(darkA, darkA + 3);
        if (dark) { segs.push({ start: dark[0], end: dark[1], kind: "dark" }); notes.push(`Avoid bright light from ${hhmm(dark[0])} to ${hhmm(dark[1])}. Wear sunglasses outside.`); }
        if (light) { segs.push({ start: light[0], end: light[1], kind: "light" }); notes.push(`Get bright light from ${hhmm(light[0])} to ${hhmm(light[1])}. Daylight outdoors works best.`); }
        if (!light) notes.push(east ? "Get daylight as soon as you wake up." : "Get daylight in the late afternoon and evening.");
        if (d === 0 && !arrivesAtNight) notes.push("If you must nap, keep it under 30 minutes and before 15:00.");
      } else {
        notes.push("Your body clock should be close to local time now. Keep regular meals and sleep.");
      }
      days.push({ phase: "after", date: addDays(arrDate, d), label: d === 0 ? "Arrival day" : `Day ${d + 1} there`, segs, notes });
    }
    return { shift, east, abs, daysToAdapt, days, dep, arr, arrLocalH, small: false };
  }, [from, to, depDate, depTime, flightH, sleep, wake, prep]);

  const zoneSelect = (id: string, value: string, set: (v: string) => void) => (
    <select id={id} className="input" value={value} onChange={e => set(e.target.value)}>{ALL_ZONES.map(z => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</select>
  );

  return (
    <div className="stack">
      <section className="panel">
        <h2>Your trip</h2>
        <div className="stack" style={{ gap: 14 }}>
          <div className="row">
            <label className="field" style={{ flexBasis: 220 }}><span>Flying from · {offsetLabel(tzOffset(from, plan.dep))}</span>{zoneSelect("sc-from", from, setFrom)}</label>
            <label className="field" style={{ flexBasis: 220 }}><span>Flying to · {offsetLabel(tzOffset(to, plan.arr))}</span>{zoneSelect("sc-to", to, setTo)}</label>
          </div>
          <div className="row">
            <label className="field"><span>Departure date</span><input id="sc-date" type="date" className="input" value={depDate} onChange={e => setDepDate(e.target.value)} /></label>
            <label className="field"><span>Departure time (local)</span><input id="sc-time" type="time" className="input" value={depTime} onChange={e => setDepTime(e.target.value)} /></label>
            <label className="field"><span>Total travel time (hours)</span><input id="sc-hours" type="number" min={1} max={40} step={0.5} className="input num" value={flightH} onChange={e => setFlightH(Math.max(1, +e.target.value || 1))} /></label>
          </div>
          <div className="row" style={{ alignItems: "center" }}>
            <label className="field"><span>You usually sleep at</span><input id="sc-sleep" type="time" className="input" value={sleep} onChange={e => setSleep(e.target.value)} /></label>
            <label className="field"><span>You usually wake at</span><input id="sc-wake" type="time" className="input" value={wake} onChange={e => setWake(e.target.value)} /></label>
            <label className="check" style={{ flex: "1 1 200px" }}><input id="sc-prep" type="checkbox" checked={prep} onChange={e => setPrep(e.target.checked)} />Start adjusting before I leave</label>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="row" style={{ gap: 36, marginBottom: 18 }}>
          <div className="stat"><b>{plan.abs % 1 ? plan.abs.toFixed(1) : plan.abs} h</b><span>Time difference</span></div>
          <div className="stat"><b>{plan.abs < 3 ? "None" : plan.east ? "East" : "West"}</b><span>Direction</span></div>
          <div className="stat"><b>{plan.small ? "0" : `~${plan.daysToAdapt}`}</b><span>Days to adjust</span></div>
          <div className="stat"><b>{hhmm(plan.arrLocalH)}</b><span>Local arrival</span></div>
        </div>
        {plan.small ? (
          <p className="empty-note">A difference under 3 hours rarely causes real jet lag. Go to bed at the local time and get daylight in the morning.</p>
        ) : (
          <>
            <DayBarLegend kinds={["sleep", "light", "dark", "caffeine"]} />
            <div className="stack" style={{ marginTop: 18, gap: 22 }}>
              {plan.days.map((d, i) => (
                <div key={i} className="sc-day">
                  <div className="sc-head">
                    <strong>{d.label}</strong>
                    <span className="note">{prettyDate(d.date)} · {d.phase === "before" ? `${zoneLabel(from)} time` : `${zoneLabel(to)} time`}</span>
                  </div>
                  {d.segs.length > 0 && <DayBar segs={d.segs} />}
                  <ul>{d.notes.map((n, k) => <li key={k}>{n}</li>)}</ul>
                </div>
              ))}
            </div>
          </>
        )}
        <p className="note" style={{ marginTop: 18 }}>Based on published light-timing guidance for jet lag. It is general advice, not medical advice. Ask a doctor before using sleep medication or melatonin.</p>
      </section>
      <style>{`.sc-day{padding-top:14px;border-top:1px solid var(--line)}.sc-head{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;margin-bottom:10px}.sc-head strong{font-family:var(--serif);font-weight:400;font-size:22px}.sc-day ul{margin:8px 0 0;padding-left:18px;display:grid;gap:3px}`}</style>
    </div>
  );
}
