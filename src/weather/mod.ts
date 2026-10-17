/**
 * Weather forecasts from Open-Meteo, normalised, with WMO weather codes in Swedish and English.
 *
 * ```ts
 * import { createWeatherClient, describeWeather, formatTemperature } from "@wingerlang/sweden-open-data/weather";
 *
 * const { current } = await createWeatherClient().forecast({ latitude: 59.33, longitude: 18.07 });
 * console.log(formatTemperature(current.temperature), describeWeather(current.code).label); // "9° Lätt regn"
 * ```
 *
 * @module
 */
export * from "./forecast.ts";
export * from "./client.ts";

export * from './history.ts';
