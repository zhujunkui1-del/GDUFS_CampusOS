"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Coordinate } from "../data/campus";
import { watchDeviceHeading } from "./device-heading";
export type MapLocation = {
  coordinate: Coordinate;
  accuracy: number;
  timestamp: number;
};
export function locationError(code: number) {
  return code === 1
    ? "定位权限未获允许，请允许定位后重试。"
    : code === 2
      ? "无法获取位置，请检查系统定位。"
      : "定位请求超时，请重试。";
}
export function requestOneTimeLocation(
  signal?: AbortSignal,
): Promise<MapLocation> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation)
      return reject(new Error("当前浏览器无法定位，请输入起点。"));
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (signal?.aborted) return reject(new Error("已停止定位。"));
        if (
          ![
            p.coords.longitude,
            p.coords.latitude,
            p.coords.accuracy,
            p.timestamp,
          ].every(Number.isFinite) ||
          p.coords.accuracy < 0 ||
          p.coords.accuracy > 100
        )
          return reject(new Error("定位精度不足，请输入起点。"));
        resolve({
          coordinate: [p.coords.longitude, p.coords.latitude],
          accuracy: p.coords.accuracy,
          timestamp: p.timestamp,
        });
      },
      (error) => reject(new Error(locationError(error.code))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}
// Device position stays in page memory. Only a user's explicit click starts acquisition.
export function useMapLocation(onHeading?: (heading: number | null) => void) {
  const [position, setPosition] = useState<MapLocation | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [tracking, setTracking] = useState(false);
  const watch = useRef<number | null>(null),
    generation = useRef(0);
  const headingStop = useRef<(() => void) | null>(null);
  const recoveryStop = useRef<(() => void) | null>(null);
  const stop = useCallback((clearError = false) => {
    ++generation.current;
    if (watch.current !== null)
      navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
    headingStop.current?.();
    headingStop.current = null;
    recoveryStop.current?.();
    recoveryStop.current = null;
    setPosition(null);
    if (clearError) setError("");
    setTracking(false);
    setBusy(false);
  }, []);
  useEffect(
    () => () => {
      ++generation.current;
      if (watch.current !== null)
        navigator.geolocation?.clearWatch(watch.current);
      headingStop.current?.();
      recoveryStop.current?.();
    },
    [],
  );
  const request = useCallback(
    (continuous = false) => {
      stop();
      setError("");
      if (!window.isSecureContext) {
        setError("当前连接不支持定位。");
        return;
      }
      if (!navigator.geolocation) {
        setError("当前浏览器不支持定位，请选择起点。");
        return;
      }
      const revision = generation.current;
      let lastFix = 0,
        refreshing = false;
      setBusy(true);
      setTracking(continuous);
      if (continuous && onHeading)
        headingStop.current = watchDeviceHeading(onHeading);
      const success = (p: GeolocationPosition) => {
        if (revision !== generation.current) return;
        if (
          !Number.isFinite(p.coords.longitude) ||
          !Number.isFinite(p.coords.latitude) ||
          !Number.isFinite(p.coords.accuracy) ||
          Math.abs(p.coords.longitude) > 180 ||
          Math.abs(p.coords.latitude) > 90 ||
          !Number.isFinite(p.timestamp) ||
          p.coords.accuracy < 0
        ) {
          if (!continuous) {
            setError("设备返回了无效定位，请重新定位。");
            stop();
          }
          return;
        }
        if (p.timestamp < lastFix) return;
        lastFix = p.timestamp;
        setPosition({
          coordinate: [p.coords.longitude, p.coords.latitude],
          accuracy: p.coords.accuracy,
          timestamp: p.timestamp,
        });
        setBusy(false);
        setError("");
      };
      const failure = (e: GeolocationPositionError) => {
        if (revision !== generation.current) return;
        if (!continuous || !lastFix || e.code === 1)
          setError(locationError(e.code));
        setBusy(false);
        if (e.code === 1) stop();
        else if (!continuous) setTracking(false);
      };
      const options = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      };
      try {
        if (continuous) {
          const startWatch = () => {
            if (watch.current !== null)
              navigator.geolocation.clearWatch(watch.current);
            watch.current = navigator.geolocation.watchPosition(
              success,
              failure,
              options,
            );
          };
          // Native watches can stay silent while stationary or after a mobile
          // browser suspension. Refresh an old fix without clearing the marker.
          const refresh = () => {
            if (
              revision !== generation.current ||
              refreshing ||
              document.hidden
            )
              return;
            refreshing = true;
            navigator.geolocation.getCurrentPosition(
              (p) => {
                refreshing = false;
                success(p);
              },
              (e) => {
                refreshing = false;
                failure(e);
              },
              options,
            );
          };
          const resume = () => {
            if (revision !== generation.current || document.hidden) return;
            refreshing = false;
            startWatch();
            refresh();
          };
          startWatch();
          const timer = setInterval(() => {
            if (Date.now() - lastFix >= 10000) refresh();
          }, 15000);
          document.addEventListener("visibilitychange", resume);
          window.addEventListener("pageshow", resume);
          recoveryStop.current = () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", resume);
            window.removeEventListener("pageshow", resume);
          };
        } else
          navigator.geolocation.getCurrentPosition(success, failure, options);
      } catch {
        stop();
        setError("浏览器未能启动定位，请检查站点定位权限后重试。");
      }
    },
    [stop, onHeading],
  );
  return { position, busy, error, tracking, request, stop };
}
