/**
 * Weather client backed by [Open-Meteo](https://open-meteo.com) – free, no API key, data under CC BY 4.0.
 *
 * @module
 */
import { type ClientOptions, type Context, createContext } from "../core/context.ts";
import { type Coordinates, assertCoordinates, roundCoordinates } from "../core/geo.ts";
import { createWeatherEnvironmentClient, type WeatherEnvironmentClient } from "./environment.ts";
import { type Forecast, openMeteoUrl, parseOpenMeteo } from "./forecast.ts";

/** Where forecasts come from – show it next to the data (required by the CC BY licence). */
export const WEATHER_SOURCE: { readonly name: string; readonly url: string; readonly license: string } = Object.freeze({
  name: "Open-Meteo",
  url: "https://open-meteo.com",
  license: "CC BY 4.0",
});

/** Options for {@link WeatherClient.forecast}. */
export interface ForecastOptions {
  /** Forecast days, 1–16. Default 7. */
  days?: number;
  signal?: AbortSignal;
}

/** Weather forecasts. */
export interface WeatherClient extends WeatherEnvironmentClient {
  /** Current conditions, hourly forecast and daily forecast for a position (rounded to ~1 km before sending). */
  forecast(position: Coordinates, options?: ForecastOptions): Promise<Forecast>;
}

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
export function createWeatherClient(options: ClientOptions | Context = {}): WeatherClient {
  const ctx = createContext(options);
  return {
    ...createWeatherEnvironmentClient(ctx),
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
