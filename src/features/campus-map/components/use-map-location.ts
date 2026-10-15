"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Coordinate } from "../data/campus";
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
export function useMapLocation() {
  const [position, setPosition] = useState<MapLocation | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [tracking, setTracking] = useState(false);
  const watch = useRef<number | null>(null),
    generation = useRef(0);
  const stop = useCallback(() => {
    ++generation.current;
    if (watch.current !== null)
      navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
    setTracking(false);
    setBusy(false);
  }, []);
  useEffect(
    () => () => {
      ++generation.current;
      if (watch.current !== null)
        navigator.geolocation?.clearWatch(watch.current);
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
      setBusy(true);
      setTracking(continuous);
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
          setError("设备返回了无效定位，请重新定位。");
          stop();
          return;
        }
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
        if (continuous)
          watch.current = navigator.geolocation.watchPosition(
            success,
            failure,
            options,
          );
        else
          navigator.geolocation.getCurrentPosition(success, failure, options);
      } catch {
        stop();
        setError("浏览器未能启动定位，请检查站点定位权限后重试。");
      }
    },
    [stop],
  );
  return { position, busy, error, tracking, request, stop };
}
