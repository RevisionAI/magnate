import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CYCLE_SECONDS, DayNightClock, FIXED_HOURS, TIME_KEYS, createLightingState, directionFromAngles, litFraction, moonShare,
  sampleLighting, shopLit, sunAngles,
} from './DayNight';

const lin = (hex: string) => new THREE.Color(hex);

describe('time-of-day keys (art §3.6)', () => {
  it('reproduces every key exactly at its hour', () => {
    const s = createLightingState();
    for (const k of TIME_KEYS) {
      sampleLighting(k.h, s);
      expect(s.skyTop.getHex()).toBe(lin(k.skyTop).getHex());
      expect(s.horizon.getHex()).toBe(lin(k.horizon).getHex());
      expect(s.hemiSky.getHex()).toBe(lin(k.hemiSky).getHex());
      expect(s.fog.getHex()).toBe(lin(k.fog).getHex());
      expect(s.hemiIntensity).toBeCloseTo(k.hemiI, 6);
      expect(s.night).toBeCloseTo(k.night, 6);
    }
  });

  it('noon is full daylight from the south-ish sun, no night emission', () => {
    const s = sampleLighting(13, createLightingState());
    expect(s.night).toBe(0);
    expect(s.moon).toBe(0);
    expect(s.lightIntensity).toBeCloseTo(2.9, 6);
    expect(s.sunElevationDeg).toBeGreaterThan(57);
    expect(s.lightDir.y).toBeGreaterThan(0.8);
    expect(s.sunVisible).toBe(1);
  });

  it('dusk drops the direct sun to ~0.03 at 20:06 (art §1.6 finding 4)', () => {
    const s = sampleLighting(20.1, createLightingState());
    expect(s.lightIntensity).toBeCloseTo(0.03, 3);
    expect(s.night).toBeCloseTo(0.6, 6);
  });

  it('midnight is moonlit night', () => {
    const s = sampleLighting(0, createLightingState());
    expect(s.night).toBe(1);
    expect(s.moon).toBe(1);
    expect(s.lightColor.getHex()).toBe(lin('#9FB4FF').getHex());
    expect(s.sunVisible).toBe(0);
    const moonDir = directionFromAngles(48, 215, new THREE.Vector3());
    expect(s.lightDir.distanceTo(moonDir)).toBeLessThan(1e-6);
  });

  it('wraps hours and interpolates continuously across midnight', () => {
    const a = sampleLighting(23.999, createLightingState());
    const b = sampleLighting(24.001, createLightingState());
    expect(Math.abs(a.night - b.night)).toBeLessThan(1e-3);
    expect(a.fog.getHex()).toBe(b.fog.getHex());
    expect(sampleLighting(-1, createLightingState()).hour).toBeCloseTo(23, 6);
  });

  it('the light never comes from below the horizon', () => {
    const s = createLightingState();
    for (let h = 0; h < 24; h += 0.25) {
      sampleLighting(h, s);
      expect(s.lightDir.y).toBeGreaterThan(0.06);
      expect(Math.abs(s.lightDir.length() - 1)).toBeLessThan(1e-6);
    }
  });
});

describe('sun path', () => {
  it('rises at 06:30, peaks at 58° around 13:07, sets at 19:45 (ESE → S → WSW)', () => {
    expect(sunAngles(6.5).elevationDeg).toBeCloseTo(0, 6);
    expect(sunAngles(19.75).elevationDeg).toBeCloseTo(0, 6);
    expect(sunAngles(13.125).elevationDeg).toBeCloseTo(58, 6);
    expect(sunAngles(6.5).azimuthDeg).toBeCloseTo(100, 6);
    expect(sunAngles(13.125).azimuthDeg).toBeCloseTo(180, 6);
    expect(sunAngles(19.75).azimuthDeg).toBeCloseTo(260, 6);
  });
  it('azimuth is measured from north (−Z) towards east (+X)', () => {
    const east = directionFromAngles(0, 90, new THREE.Vector3());
    const south = directionFromAngles(0, 180, new THREE.Vector3());
    expect(east.x).toBeCloseTo(1, 6);
    expect(south.z).toBeCloseTo(1, 6);
  });
  it('the moon takes over after dusk and hands back before sunrise', () => {
    expect(moonShare(19)).toBe(0);
    expect(moonShare(21)).toBe(1);
    expect(moonShare(3)).toBe(1);
    expect(moonShare(6.2)).toBe(0);
  });
});

describe('window and shop lighting', () => {
  it('lit share is 0.42 in the evening and 0.28 after 22:30', () => {
    expect(litFraction(20)).toBeCloseTo(0.42, 6);
    expect(litFraction(23)).toBeCloseTo(0.28, 6);
    expect(litFraction(3)).toBeCloseTo(0.28, 6);
  });
  it('shopfronts are ×2.2 while open and 0.3 after 22:00', () => {
    expect(shopLit(12)).toBeCloseTo(2.2, 6);
    expect(shopLit(23)).toBeCloseTo(0.3, 6);
    expect(shopLit(5)).toBeCloseTo(0.3, 6);
  });
});

describe('DayNightClock', () => {
  it('runs a 12-minute visual day by default', () => {
    expect(CYCLE_SECONDS).toBe(720);
    const c = new DayNightClock(10);
    c.update(30);                                   // 30 s = 1 visual hour
    expect(c.hour).toBeCloseTo(11, 6);
    for (let i = 0; i < 690; i++) c.update(1);
    expect(c.hour).toBeCloseTo(10, 4);              // full circle
  });
  it('fixed modes pin the hour and stop the clock; audio sees null only for fixed day', () => {
    const c = new DayNightClock(10);
    c.setMode('golden');
    c.update(100);
    expect(c.hour).toBe(FIXED_HOURS.golden);
    expect(c.audioHour).toBe(18.5);
    c.setMode('day');
    expect(c.hour).toBe(13);
    expect(c.audioHour).toBeNull();
  });
  it('can be paused without changing the mode', () => {
    const c = new DayNightClock(8);
    c.paused = true;
    c.update(60);
    expect(c.hour).toBe(8);
    expect(c.mode).toBe('dynamic');
  });
});
