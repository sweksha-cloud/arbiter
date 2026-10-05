/**
 * Our own list of chain restaurants that publish nutrition (TRADEOFFS.md 2c).
 * Written by us, not taken from Google: a Google place's name is matched
 * against it in memory during a session, and fatsecret is searched with *our*
 * name, so no Google content is ever sent elsewhere or stored.
 *
 * `name` is what we search fatsecret for (and expect as its brand name);
 * `aliases` are other ways the chain appears in place names.
 */
export interface Chain {
  name: string;
  aliases?: string[];
}

export const CHAINS: readonly Chain[] = [
  // Burgers and fast food
  { name: "McDonald's" },
  { name: 'Burger King' },
  { name: "Wendy's" },
  { name: 'Five Guys' },
  { name: 'In-N-Out Burger', aliases: ['In-N-Out'] },
  { name: 'Shake Shack' },
  { name: 'Whataburger' },
  { name: "Culver's" },
  { name: 'Jack in the Box' },
  { name: "Carl's Jr." },
  { name: "Hardee's" },
  { name: 'Sonic Drive-In', aliases: ['Sonic'] },
  { name: 'White Castle' },
  { name: 'The Habit Burger Grill', aliases: ['Habit Burger'] },
  { name: "Freddy's Frozen Custard & Steakburgers", aliases: ["Freddy's", "Freddy's Frozen Custard"] },
  { name: "Steak 'n Shake" },
  { name: 'Red Robin' },
  { name: "Arby's" },
  { name: 'Dairy Queen' },
  // Chicken
  { name: 'Chick-fil-A' },
  { name: 'Popeyes', aliases: ['Popeyes Chicken & Biscuits'] },
  { name: 'KFC' },
  { name: "Raising Cane's" },
  { name: "Zaxby's" },
  { name: "Bojangles" },
  { name: "Church's Texas Chicken", aliases: ["Church's Chicken"] },
  { name: 'Wingstop' },
  { name: 'Buffalo Wild Wings' },
  { name: 'El Pollo Loco' },
  { name: 'Pollo Tropical' },
  // Mexican
  { name: 'Chipotle', aliases: ['Chipotle Mexican Grill'] },
  { name: 'Taco Bell' },
  { name: 'Qdoba', aliases: ['Qdoba Mexican Grill'] },
  { name: "Moe's Southwest Grill" },
  { name: 'Del Taco' },
  { name: 'Baja Fresh', aliases: ['Baja Fresh Mexican Grill'] },
  // Sandwiches
  { name: 'Subway' },
  { name: "Jersey Mike's" },
  { name: "Jimmy John's" },
  { name: 'Firehouse Subs' },
  { name: 'Potbelly' },
  { name: "Jason's Deli" },
  { name: "McAlister's Deli" },
  { name: 'Panera Bread', aliases: ['Panera'] },
  { name: 'Corner Bakery', aliases: ['Corner Bakery Cafe'] },
  // Bowls, salads, Mediterranean
  { name: 'Sweetgreen' },
  { name: 'Cava' },
  { name: 'Noodles & Company' },
  { name: 'Panda Express' },
  { name: "P.F. Chang's" },
  { name: 'Pei Wei' },
  // Pizza
  { name: "Domino's", aliases: ["Domino's Pizza"] },
  { name: 'Pizza Hut' },
  { name: "Papa John's" },
  { name: 'Little Caesars' },
  { name: "Papa Murphy's", aliases: ["Papa Murphy's Pizza"] },
  { name: 'Blaze Pizza' },
  { name: 'MOD Pizza' },
  // Sit-down
  { name: 'Olive Garden' },
  { name: "Applebee's" },
  { name: "Chili's" },
  { name: 'Outback Steakhouse' },
  { name: 'Texas Roadhouse' },
  { name: 'LongHorn Steakhouse' },
  { name: 'The Cheesecake Factory', aliases: ['Cheesecake Factory'] },
  { name: 'Red Lobster' },
  { name: 'TGI Fridays' },
  { name: "BJ's Restaurant", aliases: ["BJ's Restaurant & Brewhouse"] },
  { name: 'Ruby Tuesday' },
  { name: "Maggiano's" },
  { name: "Carrabba's", aliases: ["Carrabba's Italian Grill"] },
  { name: 'Benihana' },
  // Breakfast and coffee
  { name: 'IHOP' },
  { name: "Denny's" },
  { name: 'Cracker Barrel' },
  { name: 'Waffle House' },
  { name: 'Bob Evans' },
  { name: 'Starbucks' },
  { name: "Dunkin'", aliases: ['Dunkin', "Dunkin' Donuts"] },
  { name: "Peet's Coffee", aliases: ["Peet's Coffee & Tea"] },
  { name: 'Tim Hortons' },
  { name: 'Einstein Bros. Bagels', aliases: ['Einstein Bros', 'Einstein Brothers Bagels'] },
  { name: 'Tropical Smoothie Cafe' },
  { name: 'Smoothie King' },
  { name: 'Jamba', aliases: ['Jamba Juice'] },
  { name: 'Krispy Kreme' }
];

/** Lowercase, straight apostrophes removed, "&" as "and", punctuation as spaces. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const MATCHERS = CHAINS.flatMap((chain) =>
  [chain.name, ...(chain.aliases ?? [])].map((alias) => ({ chain, alias: normalizeName(alias) }))
).sort((a, b) => b.alias.length - a.alias.length); // Longest first: "Dunkin Donuts" before "Dunkin".

/**
 * The chain a place belongs to, if any: its name equals or starts with one of
 * the chain's names ("Chipotle Mexican Grill" → Chipotle). Called during a
 * session only; the result is never stored (Google's terms).
 */
export function matchChain(placeName: string): Chain | undefined {
  const name = normalizeName(placeName);
  return MATCHERS.find(({ alias }) => name === alias || name.startsWith(`${alias} `))?.chain;
}
