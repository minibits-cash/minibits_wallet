/* import _AsyncStorage from "@react-native-async-storage/async-storage" */

/**
 * Loads a string from storage.
 *
 * @param key The key to fetch.
 */
/* const loadString = async function (key: string): Promise<string | null> {
  try {
    return await _AsyncStorage.getItem(key)
  } catch {
    // not sure why this would fail... even reading the RN docs I'm unclear
    return null
  }
} */

/**
 * Saves a string to storage.
 *
 * @param key The key to fetch.
 * @param value The value to store.
 */
/* const saveString = async function (key: string, value: string): Promise<boolean> {
  try {
    await _AsyncStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
} */

/**
 * Loads something from storage and runs it thru JSON.parse.
 *
 * @param key The key to fetch.
 */
/* const load = async function (key: string): Promise<any | null> {
  try {
    const almostThere = await _AsyncStorage.getItem(key)
    return JSON.parse(almostThere as string)
  } catch {
    return null
  }
} */

/**
 * Saves an object to storage.
 *
 * @param key The key to fetch.
 * @param value The value to store.
 */
/* const save = async function (key: string, value: any): Promise<boolean> {
  try {
    await _AsyncStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
} */

/**
 * Removes something from storage.
 *
 * @param key The key to kill.
 */
/* const remove = async function (key: string): Promise<void> {
  try {
    await _AsyncStorage.removeItem(key)
  } catch {}
} */

/**
 * Burn it all to the ground.
 */
/* const cleanAll = async function (): Promise<void> {
  try {
    await _AsyncStorage.clear()
  } catch {}
}

export const AsyncStorage = {
  loadString,
  saveString,
  load,
  save,
  remove,
  cleanAll
} */