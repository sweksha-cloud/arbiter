import type { GroupMemberPreferences, PlaceCandidate } from './domain.js';

export function eliminateByHardConstraints(
  places: PlaceCandidate[],
  preferences: GroupMemberPreferences[]
): PlaceCandidate[] {
  return places.filter((place) => {
    return preferences.every(({ hard }) => {
      if (hard.vegetarianOnly && !place.hasVegetarianOptions) return false;
      if (hard.noFastFood && place.isFastFood) return false;
      if (hard.maxDriveMinutes !== undefined && place.driveMinutes > hard.maxDriveMinutes) return false;
      if (hard.maxPriceLevel !== undefined && place.priceLevel > hard.maxPriceLevel) return false;
      return true;
    });
  });
}
