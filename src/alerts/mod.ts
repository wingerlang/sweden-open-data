/**
 * VMA, news from Swedish authorities (Krisinformation.se) and SMHI weather warnings, matched to places.
 *
 * ```ts
 * import { createAlertsClient } from "@wingerlang/sweden-open-data/alerts";
 *
 * const { alerts } = await createAlertsClient().near([{ latitude: 56.1, longitude: 13.91 }]);
 * ```
 *
 * @module
 */
export * from "./alerts.ts";
export * from "./client.ts";
