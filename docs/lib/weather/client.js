/**
 * Weather client backed by [Open-Meteo](https://open-meteo.com) – free, no API key, data under CC BY 4.0.
 *
 * @module
 */
import { createContext } from "../core/context.js";
import { assertCoordinates, roundCoordinates } from "../core/geo.js";
import { createWeatherEnvironmentClient } from "./environment.js";
import { createWeatherHistoryClient } from "./history.js";
import { openMeteoUrl, parseOpenMeteo } from "./forecast.js";
/** Where forecasts come from – show it next to the data (required by the CC BY licence). */
export const WEATHER_SOURCE = Object.freeze({
  name: "Open-Meteo",
  url: "https://open-meteo.com",
  license: "CC BY 4.0",
});
/**
 * Creates a {@link WeatherClient}.
 *
 * @example
 * ```ts
 * const weather = createWeatherClient();
 * const { current } = await weather.forecast({ latitude: 59.33, longitude: 18.07 });
 * console.log(`${formatTemperature(current.temperature)} ${describeWeather(current.code).label}`);
 * ```
 */
export function createWeatherClient(options = {}) {
  const ctx = createContext(options);
  return {
    ...createWeatherEnvironmentClient(ctx),
    ...createWeatherHistoryClient(ctx),
    async forecast(position, options = {}) {
      assertCoordinates(position, "position");
      const p = roundCoordinates(position, ctx.precision);
      const days = options.days ?? 7;
      const url = openMeteoUrl(p, { base: ctx.endpoints.weather, days, precision: ctx.precision });
      return ctx.cache.get(
        `weather:${p.latitude},${p.longitude}:${days}`,
        ctx.ttl.weather,
        async (signal) => parseOpenMeteo(await ctx.http.json("open-meteo", url, { signal }), ctx.now()),
        { signal: options.signal, source: "open-meteo" },
      );
    },
  };
}
