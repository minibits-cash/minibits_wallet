import AppError, { Err } from "../utils/AppError"
import { log } from "../utils/logger"

    export const getRandomAvatar = async function () {
        const url = getRandomAvatarUrl()

        try {            
            const method = 'GET'        
            const headers = getPublicHeaders()   
            
    
            const avatarSvg = await fetchApi(url, {
                method,
                headers
            })
    
            return avatarSvg

        } catch (e: any) {
            throw new AppError(Err.NETWORK_ERROR, 'Could not get avatar image', e.message)
        }
    }

    export const getRandomAvatarUrl = function () {
        const queryParams = []
    
        for (const key in avatarOptions) {
            const options = avatarOptions[key]
            const randomIndex = Math.floor(Math.random() * options.length)
            const selectedOption = options[randomIndex]
            queryParams.push(`${key}=${selectedOption}`)
        }

        const url = 'https://avataaars.io/?avatarStyle=Circle&' + queryParams.join('&')   
    
        return url 
    }
  


    const avatarOptions = {
    "topType": [
      "NoHair",
      "Eyepatch",
      "Hat",
      "Hijab",
      "Turban",
      "WinterHat1",
      "WinterHat2",
      "WinterHat3",
      "WinterHat4",
      "LongHairBigHair",
      "LongHairBob",
      "LongHairBun",
      "LongHairCurly",
      "LongHairCurvy",
      "LongHairDreads",
      "LongHairFrida",
      "LongHairFro",
      "LongHairFroBand",
      "LongHairNotTooLong",
      "LongHairShavedSides",
      "LongHairMiaWallace",
      "LongHairStraight",
      "LongHairStraight2",
      "LongHairStraightStrand",
      "ShortHairDreads01",
      "ShortHairDreads02",
      "ShortHairFrizzle",
      "ShortHairShaggyMullet",
      "ShortHairShortCurly",
      "ShortHairShortFlat",
      "ShortHairShortRound",
      "ShortHairShortWaved",
      "ShortHairSides",
      "ShortHairTheCaesar",
      "ShortHairTheCaesarSidePart"
    ],
    "accessoriesType": [
      "Blank",
      "Kurt",
      "Prescription01",
      "Prescription02",
      "Round",
      "Sunglasses",
      "Wayfarers"
    ],
    "hairColor": [
      "Auburn",
      "Black",
      "Blonde",
      "BlondeGolden",
      "Brown",
      "BrownDark",
      "PastelPink",
      "Blue",
      "Platinum",
      "Red",
      "SilverGray"
    ],
    "facialHairType": [
      "Blank",
      "BeardMedium",
      "BeardLight",
      "BeardMajestic",
      "MoustacheFancy",
      "MoustacheMagnum"
    ],
    "facialHairColor": [
      "Auburn",
      "Black",
      "Blonde",
      "BlondeGolden",
      "Brown",
      "BrownDark",
      "Platinum",
      "Red"
    ],
    "clotheType": [
      "BlazerShirt",
      "BlazerSweater",
      "CollarSweater",
      "GraphicShirt",
      "Hoodie",
      "Overall",
      "ShirtCrewNeck",
      "ShirtScoopNeck",
      "ShirtVNeck"
    ],
    "clotheColor": [
      "Black",
      "Blue01",
      "Blue02",
      "Blue03",
      "Gray01",
      "Gray02",
      "Heather",
      "PastelBlue",
      "PastelGreen",
      "PastelOrange",
      "PastelRed",
      "PastelYellow",
      "Pink",
      "Red",
      "White"
    ],
    "eyeType": [
      "Close",
      "Cry",
      "Default",
      "Dizzy",
      "EyeRoll",
      "Happy",
      "Hearts",
      "Side",
      "Squint",
      "Surprised",
      "Wink",
      "WinkWacky"
    ],
    "eyebrowType": [
      "Angry",
      "AngryNatural",
      "Default",
      "DefaultNatural",
      "FlatNatural",
      "RaisedExcited",
      "RaisedExcitedNatural",
      "SadConcerned",
      "SadConcernedNatural",
      "UnibrowNatural",
      "UpDown",
      "UpDownNatural"
    ],
    "mouthType": [
      "Concerned",
      "Default",
      "Disbelief",
      "Eating",
      "Grimace",
      "Sad",
      "ScreamOpen",
      "Serious",
      "Smile",
      "Tongue",
      "Twinkle",
      "Vomit"
    ],
    "skinColor": [
      "Tanned",
      "Yellow",
      "Pale",
      "Light",
      "Brown",
      "DarkBrown",
      "Black"
    ]
  }


  const fetchApi = async (url: string, options: any, timeout = 5000) => { //ms
    try {
        const controller = new AbortController()

        const promise = fetch(url, options)
        const kill = new Promise((resolve) => setTimeout(resolve, timeout))
        const response: Response = await Promise.race([promise, kill]) as Response

        if (!response) {
            controller.abort()
            throw new Error('API takes too long to response')
        }

        const responseText = await response.text()

        if (!response.ok) {            
            throw new Error(responseText)
        }

        return responseText
    } catch (e) {
        throw e
    }
}


const getPublicHeaders = () => {   
    const requestHeaders = new Headers()
    requestHeaders.append('Accept-encoding', 'gzip, deflate')
    requestHeaders.append('Accept', 'image/svg+xml')
    return requestHeaders
}