export type Cuisine = 'any' | 'vegetarian' | 'fast_food' | 'italian' | 'indian' | 'thai' | 'mexican';

export interface GroupMemberPreferences {
  memberId: string;
  hard: {
    vegetarianOnly?: boolean;
    noFastFood?: boolean;
    maxDriveMinutes?: number;
    maxPriceLevel?: number;
  };
}

export interface PlaceCandidate {
  id: string;
  name: string;
  cuisines: Cuisine[];
  isFastFood: boolean;
  driveMinutes: number;
  priceLevel: number;
  hasVegetarianOptions: boolean;
}
