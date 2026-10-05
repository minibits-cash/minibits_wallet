import {createAvatar} from '@dicebear/core'
import * as avataaars from '@dicebear/avataaars'

// Avatars are drawn locally with DiceBear's avataaars port. The server bundles the very same
// package (same exact version) and the same AvatarSelection → DiceBear mapping below, so the
// preview composed here is pixel identical to the PNG the server stores on save.
// KEEP IN SYNC with minibits_server src/services/avatarService.ts.

export type AvatarSelection = Record<string, string>

const NONE = 'none'
// colors have no enum, only a hex pattern, but every trait's default lists all its values
const schemaValues = (key: string): string[] => (avataaars.schema.properties as any)[key].default

export const AVATAR_TRAITS: Record<string, string[]> = {
    top: [NONE, ...schemaValues('top')],
    hairColor: schemaValues('hairColor'),
    accessories: [NONE, ...schemaValues('accessories')],
    eyes: schemaValues('eyes'),
    eyebrows: schemaValues('eyebrows'),
    mouth: schemaValues('mouth'),
    facialHair: [NONE, ...schemaValues('facialHair')],
    skinColor: schemaValues('skinColor'),
    clothing: schemaValues('clothing'),
    clothesColor: schemaValues('clothesColor'),
}

// Every DiceBear option is pinned, otherwise it falls back to a seed based random pick.
const toDicebearOptions = (s: AvatarSelection) => ({
    size: 256,
    style: ['circle'],
    backgroundColor: ['65c9ff'],
    base: ['default'],
    nose: ['default'],
    top: [s.top === NONE ? AVATAR_TRAITS.top[1] : s.top],
    topProbability: s.top === NONE ? 0 : 100,
    hatColor: [s.clothesColor],
    hairColor: [s.hairColor],
    accessories: [s.accessories === NONE ? AVATAR_TRAITS.accessories[1] : s.accessories],
    accessoriesProbability: s.accessories === NONE ? 0 : 100,
    accessoriesColor: ['262e33'],
    facialHair: [s.facialHair === NONE ? AVATAR_TRAITS.facialHair[1] : s.facialHair],
    facialHairProbability: s.facialHair === NONE ? 0 : 100,
    facialHairColor: [s.hairColor],
    eyes: [s.eyes],
    eyebrows: [s.eyebrows],
    mouth: [s.mouth],
    skinColor: [s.skinColor],
    clothing: [s.clothing],
    clothesColor: [s.clothesColor],
    clothingGraphic: ['bat'],
})

export const randomAvatarSelection = (): AvatarSelection =>
    Object.fromEntries(Object.entries(AVATAR_TRAITS).map(([key, values]) =>
        [key, values[Math.floor(Math.random() * values.length)]]
    ))

// A stored selection can go stale if a DiceBear upgrade renames or drops a value.
export const isValidAvatarSelection = (selection?: AvatarSelection): selection is AvatarSelection =>
    !!selection && Object.keys(AVATAR_TRAITS).every(key => AVATAR_TRAITS[key].includes(selection[key]))

export const renderAvatarSvg = (selection: AvatarSelection): string =>
    createAvatar(avataaars, toDicebearOptions(selection) as any).toString() // values come from the schema
