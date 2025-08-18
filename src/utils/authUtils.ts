function base64urlDecode(base64url: string) {
  // Replace base64url characters with base64 standard ones
  let base64 = base64url
    .replace(/-/g, '+') // Replace '-' with '+'
    .replace(/_/g, '/') // Replace '_' with '/'
    .replace(/[^A-Za-z0-9+/=]/g, ''); // Clean up any other characters
  
  // Pad the base64 string to make it a multiple of 4 if necessary
  while (base64.length % 4) {
    base64 += '=';
  }

  // Decode base64 to a string
  const decodedString = atob(base64);
  return decodedString;
}




export const decodeJwtExpiry = (token: string): number | null => {
  try {
    // Split the token into its parts: header, payload, and signature
    const [, payload] = token.split('.')

    if (!payload) {
      throw new Error('Invalid JWT token format')
    }

    // Decode the payload from Base64URL
    const decodedPayload = JSON.parse(base64urlDecode(payload))

    // Return the `exp` field (expiry time in seconds since epoch)
    return decodedPayload.exp || null
  } catch (error) {
    console.error('Failed to decode JWT token:', error)
    return null
  }
}