/**
 * A curated vocabulary of sports with stable ids, Swedish names, aliases and a category – for autocomplete and for
 * storing a sport by id. Public sport names only: organisations, participation and training histories belong to the
 * consuming application. No network.
 *
 * ```ts
 * import { findSport, searchSports } from "@wingerlang/sweden-open-data/sports";
 *
 * searchSports("brott", 5); // [{ id: "sport:wrestling", name: "Brottning", … }]
 * findSport("wrestling")?.id; // "sport:wrestling"
 * ```
 *
 * @module
 */
import { fold } from "../core/parse.ts";

/** A sport. */
export interface Sport {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly category:
    | "ball"
    | "racket"
    | "combat"
    | "endurance"
    | "water"
    | "winter"
    | "strength"
    | "precision"
    | "outdoor"
    | "other";
  readonly aliases: readonly string[];
}
/** Curated autocomplete vocabulary, not an exhaustive RF membership or competition classification. */
export const SPORTS_SOURCE: Readonly<{ kind: "curated"; referenceUrl: string; checkedAt: string }> = Object.freeze({
  kind: "curated",
  referenceUrl: "https://www.rf.se/om-riksidrottsforbundet/hitta-inom-idrottsrorelsen",
  checkedAt: "2026-10-19",
});
const rows: readonly (readonly [string, string, string, Sport["category"], ...string[]])[] = [
  ["football", "Fotboll", "⚽", "ball", "soccer", "football"],
  ["basketball", "Basket", "🏀", "ball", "basketboll", "basketball"],
  ["handball", "Handboll", "🤾", "ball", "handball"],
  ["volleyball", "Volleyboll", "🏐", "ball", "volleyball"],
  ["beach-volleyball", "Beachvolley", "🏐", "ball", "beachvolleyboll", "beach volleyball"],
  ["floorball", "Innebandy", "🏑", "ball", "floorball"],
  ["ice-hockey", "Ishockey", "🏒", "winter", "hockey", "ice hockey"],
  ["bandy", "Bandy", "🏒", "winter"],
  ["american-football", "Amerikansk fotboll", "🏈", "ball", "american football"],
  ["rugby", "Rugby", "🏉", "ball"],
  ["baseball", "Baseboll", "⚾", "ball", "baseball"],
  ["softball", "Softboll", "🥎", "ball", "softball"],
  ["cricket", "Cricket", "🏏", "ball"],
  ["futsal", "Futsal", "⚽", "ball"],
  ["water-polo", "Vattenpolo", "🤽", "water", "water polo"],
  ["tennis", "Tennis", "🎾", "racket"],
  ["table-tennis", "Bordtennis", "🏓", "racket", "pingis", "table tennis"],
  ["badminton", "Badminton", "🏸", "racket"],
  ["padel", "Padel", "🎾", "racket"],
  ["squash", "Squash", "🎾", "racket"],
  ["wrestling", "Brottning", "🤼", "combat", "wrestling", "grekisk-romersk brottning", "fristilsbrottning"],
  ["boxing", "Boxning", "🥊", "combat", "boxing"],
  ["judo", "Judo", "🥋", "combat"],
  ["karate", "Karate", "🥋", "combat"],
  ["taekwondo", "Taekwondo", "🥋", "combat", "tae kwon do"],
  ["jiu-jitsu", "Jujutsu", "🥋", "combat", "jujitsu", "jiu-jitsu", "ju-jutsu"],
  ["bjj", "Brasiliansk jiu-jitsu", "🥋", "combat", "bjj", "brazilian jiu jitsu"],
  ["aikido", "Aikido", "🥋", "combat"],
  ["muay-thai", "Thaiboxning", "🥊", "combat", "muay thai"],
  ["kickboxing", "Kickboxning", "🥊", "combat", "kickboxing"],
  ["mma", "MMA", "🥋", "combat", "mixed martial arts"],
  ["fencing", "Fäktning", "🤺", "combat", "fencing"],
  ["running", "Löpning", "🏃", "endurance", "running", "joggning", "jogging"],
  ["athletics", "Friidrott", "🏃", "endurance", "athletics", "track and field"],
  ["cycling", "Cykling", "🚴", "endurance", "cykel", "cycling", "landsvägscykling"],
  ["mountain-bike", "Mountainbike", "🚵", "outdoor", "mtb", "mountain bike"],
  ["triathlon", "Triathlon", "🏊", "endurance"],
  ["orienteering", "Orientering", "🧭", "outdoor", "orienteering"],
  ["swimming", "Simning", "🏊", "water", "swimming"],
  ["diving", "Simhopp", "🏊", "water", "diving"],
  ["artistic-swimming", "Konstsim", "🏊", "water", "artistic swimming"],
  ["sailing", "Segling", "⛵", "water", "sailing"],
  ["rowing", "Rodd", "🚣", "water", "rowing"],
  ["canoeing", "Kanot", "🛶", "water", "kanotpaddling", "canoeing", "kajak", "kayak"],
  ["surfing", "Surfing", "🏄", "water", "surf"],
  ["windsurfing", "Vindsurfing", "🏄", "water", "windsurfing"],
  ["scuba-diving", "Dykning", "🤿", "water", "sportdykning", "scuba diving"],
  ["alpine-skiing", "Alpin skidåkning", "⛷️", "winter", "slalom", "alpine skiing", "utförsåkning"],
  ["cross-country-skiing", "Längdskidåkning", "🎿", "winter", "längdskidor", "cross country skiing"],
  ["biathlon", "Skidskytte", "🎿", "winter", "biathlon"],
  ["snowboarding", "Snowboard", "🏂", "winter", "snowboarding"],
  ["figure-skating", "Konståkning", "⛸️", "winter", "figure skating"],
  ["speed-skating", "Skridsko", "⛸️", "winter", "hastighetsåkning", "speed skating"],
  ["curling", "Curling", "🥌", "winter"],
  ["strength-training", "Styrketräning", "🏋️", "strength", "gym", "strength training", "weight training"],
  ["powerlifting", "Styrkelyft", "🏋️", "strength", "powerlifting"],
  ["weightlifting", "Tyngdlyftning", "🏋️", "strength", "weightlifting"],
  ["crossfit", "Crossfit", "🏋️", "strength", "cross fit"],
  ["gymnastics", "Gymnastik", "🤸", "other", "gymnastics", "truppgymnastik"],
  ["dance", "Dans", "💃", "other", "danssport", "dance", "dansning"],
  ["cheerleading", "Cheerleading", "📣", "other"],
  ["yoga", "Yoga", "🧘", "other"],
  ["pilates", "Pilates", "🧘", "other"],
  ["golf", "Golf", "⛳", "precision"],
  ["disc-golf", "Discgolf", "🥏", "precision", "frisbeegolf", "disc golf"],
  ["ultimate", "Ultimate", "🥏", "ball", "ultimate frisbee"],
  ["bowling", "Bowling", "🎳", "precision"],
  ["boules", "Boule", "🎯", "precision", "boules", "petanque", "pétanque"],
  ["darts", "Dart", "🎯", "precision", "darts"],
  ["archery", "Bågskytte", "🏹", "precision", "archery"],
  ["shooting", "Sportskytte", "🎯", "precision", "skytte", "shooting"],
  ["billiards", "Biljard", "🎱", "precision", "billiards", "snooker", "pool"],
  ["equestrian", "Ridsport", "🐎", "outdoor", "ridning", "equestrian", "hästsport"],
  ["climbing", "Klättring", "🧗", "outdoor", "climbing", "bouldering"],
  ["hiking", "Vandring", "🥾", "outdoor", "hiking", "fjällvandring"],
  ["walking", "Promenad", "🚶", "endurance", "gång", "walking", "powerwalk"],
  ["skateboarding", "Skateboard", "🛹", "outdoor", "skateboarding"],
  ["roller-skating", "Rullskridskor", "🛼", "outdoor", "roller derby", "inlines"],
  ["motorsport", "Bilsport", "🏎️", "other", "motorsport", "rally", "karting"],
  ["motorcycling", "Motorcykelsport", "🏍️", "other", "motocross", "enduro", "speedway"],
  ["esports", "E-sport", "🎮", "other", "esport", "esports"],
];
const sports: readonly Sport[] = Object.freeze(
  rows
    .map(([id, name, emoji, category, ...aliases]) =>
      Object.freeze({ id: "sport:" + id, name, emoji, category, aliases: Object.freeze(aliases) }),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "sv")),
);
/** Immutable shared reference vocabulary. @example getSports().find(s => s.name === 'Brottning') */
export function getSports(): readonly Sport[] {
  return sports;
}
/** Exact stable ID, name or alias; free text remains the caller's own value. @example findSport('wrestling')?.id */
export function findSport(value: string): Sport | undefined {
  const key = fold(value);
  return sports.find((s) => s.id === value || [s.name, ...s.aliases].some((name) => fold(name) === key));
}
/** Accent-insensitive, bounded autocomplete. @example searchSports('brott',5) */
export function searchSports(query: string, limit = 10): readonly Sport[] {
  const key = fold(query),
    max = Number.isFinite(limit) ? Math.min(100, Math.max(0, Math.floor(limit))) : 10,
    terms = key.split(" ");
  return sports
    .filter((s) => !key || [s.name, ...s.aliases].some((name) => terms.every((term) => fold(name).includes(term))))
    .sort(
      (a, b) =>
        Number([b.name, ...b.aliases].some((n) => fold(n) === key)) -
          Number([a.name, ...a.aliases].some((n) => fold(n) === key)) || a.name.localeCompare(b.name, "sv"),
    )
    .slice(0, max);
}
