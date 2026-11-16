"use client";
import { ColorType, createChart, LineStyle, type IChartApi, type Time } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { ema, sma } from "@/lib/indicators";

const C = { text: "#8b98ab", grid: "#1c2633", up: "#2ebd85", down: "#f0616d", line: "#263243" };
export const SERIES = ["#5b9dff", "#e8a33d", "#c084fc", "#8b98ab"];

function base(el: HTMLElement, height: number): IChartApi {
  return createChart(el, {
    height,
    width: el.clientWidth,
    layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: C.text, fontSize: 11 },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderColor: C.line },
    timeScale: { borderColor: C.line, rightOffset: 3 },
    crosshair: { mode: 1 },
    handleScroll: { vertTouchDrag: false },
  });
}
function autosize(el: HTMLElement, chart: IChartApi) {
  const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
  ro.observe(el);
  return () => {
    ro.disconnect();
    chart.remove();
  };
}

export type BarTuple = [string, number, number, number, number, number];

export function PriceChart({ bars, stop, target, height = 380 }: { bars: BarTuple[]; stop?: number; target?: number; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !bars.length) return;
    const chart = base(el, height);
    const candles = chart.addCandlestickSeries({ upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down });
    candles.setData(bars.map(([d, o, h, l, c]) => ({ time: d as Time, open: o, high: h, low: l, close: c })));
    const vol = chart.addHistogramSeries({ priceScaleId: "", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    vol.setData(bars.map(([d, o, , , c, v]) => ({ time: d as Time, value: v, color: c >= o ? "rgba(46,189,133,.35)" : "rgba(240,97,109,.35)" })));
    const closes = bars.map((b) => b[4]);
    const lines: [number[], string, string][] = [
      [ema(closes, 20), SERIES[0], "EMA 20"],
      [sma(closes, 50), SERIES[1], "SMA 50"],
      [sma(closes, 200), SERIES[2], "SMA 200"],
    ];
    for (const [vals, color, title] of lines) {
      const s = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title });
      s.setData(vals.map((v, i) => ({ time: bars[i][0] as Time, value: v })).filter((p) => Number.isFinite(p.value)));
    }
    if (stop) candles.createPriceLine({ price: stop, color: C.down, lineStyle: LineStyle.Dashed, lineWidth: 1, title: "Stop" });
    if (target) candles.createPriceLine({ price: target, color: C.up, lineStyle: LineStyle.Dashed, lineWidth: 1, title: "Target" });
    chart.timeScale().setVisibleLogicalRange({ from: bars.length - 130, to: bars.length + 3 });
    return autosize(el, chart);
  }, [bars, stop, target, height]);
  return <div ref={ref} style={{ height }} className="w-full" />;
}

/** Cumulative-result curves. Each series is [date, value][]; dates may repeat (last value wins). */
export function CurveChart({ series, height = 260, suffix = "%" }: { series: { name: string; points: [string, number][] }[]; height?: number; suffix?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = base(el, height);
    chart.applyOptions({ localization: { priceFormatter: (p: number) => `${p.toFixed(0)}${suffix}` } });
    series.forEach((s, i) => {
      const byDate = new Map(s.points);
      const data = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({ time: d as Time, value: v }));
      chart.addLineSeries({ color: SERIES[i % SERIES.length], lineWidth: 2, priceLineVisible: false, lastValueVisible: true }).setData(data);
    });
    chart.timeScale().fitContent();
    return autosize(el, chart);
  }, [series, height, suffix]);
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-xs text-muted">
        {series.map((s, i) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: SERIES[i % SERIES.length] }} />
            {s.name}
          </span>
        ))}
      </div>
      <div ref={ref} style={{ height }} className="w-full" />
    </div>
  );
}
