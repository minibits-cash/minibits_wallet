import React, {useEffect, useRef, useState} from 'react'
import {ActivityIndicator, Pressable, ScrollView, View, ViewStyle} from 'react-native'
import FastImage from 'react-native-fast-image'
import {colors, spacing, useThemeColor} from '../theme'
import {Button, Card, ErrorModal, Header, Icon, IconTypes, ListItem, Loading, Screen} from '../components'
import {useStores} from '../models'
import {MinibitsClient} from '../services'
import AppError from '../utils/AppError'
import {scale} from '@gocodingnow/rn-size-matters'
import {getImageSource} from '../utils/utils'
import {StaticScreenProps, useNavigation} from '@react-navigation/native'
import {useTabBarInset} from '../navigation/tabBarVisibility'

type Props = StaticScreenProps<undefined>

type AvatarOptions = Record<string, string[]>
type AvatarSelection = Record<string, string>

// Each tile steps one avataaars option to its next value. Eyebrows are only touched by Random.
const TRAITS: {key: string, icon: IconTypes, label: string}[] = [
    {key: 'topType', icon: 'faScissors', label: 'Hair or headwear'},
    {key: 'hairColor', icon: 'faPalette', label: 'Hair color'},
    {key: 'accessoriesType', icon: 'faGlasses', label: 'Glasses'},
    {key: 'eyeType', icon: 'faEye', label: 'Eyes'},
    {key: 'mouthType', icon: 'faFaceSmile', label: 'Mouth'},
    {key: 'facialHairType', icon: 'faMask', label: 'Facial hair'},
    {key: 'skinColor', icon: 'faEyeDropper', label: 'Skin'},
    {key: 'clotheType', icon: 'faShirt', label: 'Clothes'},
    {key: 'clotheColor', icon: 'faFillDrip', label: 'Clothes color'},
]

const RENDER_DEBOUNCE_MS = 300

const randomSelection = (options: AvatarOptions): AvatarSelection =>
    Object.fromEntries(Object.entries(options).map(([key, values]) =>
        [key, values[Math.floor(Math.random() * values.length)]]
    ))

export const PictureScreen = function PictureScreen({route}: Props) {
    const navigation = useNavigation()
    const {walletProfileStore} = useStores()
    const tabBarInset = useTabBarInset()

    const [error, setError] = useState<AppError | undefined>()
    const [isSaving, setIsSaving] = useState(false)
    const [isRendering, setIsRendering] = useState(true)
    const [options, setOptions] = useState<AvatarOptions>()
    const [selection, setSelection] = useState<AvatarSelection>()
    const [png, setPng] = useState<string>()
    const renderId = useRef(0)

    useEffect(() => {
        MinibitsClient.getAvatarOptions()
            .then(loaded => {
                setOptions(loaded)
                setSelection(randomSelection(loaded))
            })
            .catch(handleError)
    }, [])

    // Each tap re-renders on the server, so fast taps are debounced and only the latest response is shown.
    useEffect(() => {
        if (!selection) return

        const id = ++renderId.current
        setIsRendering(true)

        const timer = setTimeout(async () => {
            try {
                const rendered = await MinibitsClient.renderAvatar(selection)
                if (id === renderId.current) {
                    setPng(rendered)
                    setIsRendering(false)
                }
            } catch (e: any) {
                if (id === renderId.current) handleError(e)
            }
        }, RENDER_DEBOUNCE_MS)

        return () => clearTimeout(timer)
    }, [selection])

    const onTraitPress = function (key: string) {
        if (!options || !selection) return

        const values = options[key]
        const next = values[(values.indexOf(selection[key]) + 1) % values.length]
        const update: AvatarSelection = {[key]: next}

        // keep the beard matching the hair where the colors overlap
        if (key === 'hairColor' && options.facialHairColor?.includes(next)) {
            update.facialHairColor = next
        }

        setSelection({...selection, ...update})
    }

    const onRandom = function () {
        if (options) setSelection(randomSelection(options))
    }

    const onSave = async function () {
        if (!png) return
        try {
            setIsSaving(true)
            await walletProfileStore.updatePicture(png)
            setIsSaving(false)
            navigation.goBack()
        } catch (e: any) {
            handleError(e)
        }
    }

    const handleError = function (e: AppError): void {
        setIsSaving(false)
        setIsRendering(false)
        setError(e)
    }

    const iconColor = useThemeColor('text')
    const indicatorColor = useThemeColor('textDim')

    return (
      <Screen contentContainerStyle={$screen} preset='fixed'>
        <Header
            leftIcon='faArrowLeft'
            onLeftPress={() => navigation.goBack()}
            titleTx='profileScreen_changeAvatar'
        />
        <ScrollView contentContainerStyle={[$contentContainer, {paddingBottom: tabBarInset}]}>
            {!options && !isRendering ? (
                <Card
                    ContentComponent={<ListItem leftIcon='faXmark' tx='pictureRetrieveFail' />}
                />
            ) : (
                <>
                    <View style={$preview}>
                        {png && (
                            <FastImage style={$previewImage} source={{uri: getImageSource(png)}} />
                        )}
                        {isRendering && (
                            <ActivityIndicator style={$previewSpinner} color={indicatorColor} size='large' />
                        )}
                    </View>
                    <View style={$traits}>
                        {TRAITS.filter(trait => !options || options[trait.key]).map(trait => (
                            <Pressable
                                key={trait.key}
                                style={({pressed}) => [$trait, pressed && {opacity: 0.5}]}
                                onPress={() => onTraitPress(trait.key)}
                                disabled={!selection}
                                accessibilityRole='button'
                                accessibilityLabel={trait.label}
                            >
                                <Icon icon={trait.icon} size={spacing.large} color={iconColor} />
                            </Pressable>
                        ))}
                    </View>
                    <View style={$buttonContainer}>
                        <Button
                            preset='secondary'
                            tx='pictureRandom'
                            LeftAccessory={() => <Icon icon='faDice' />}
                            onPress={onRandom}
                            disabled={!options}
                        />
                        <Button
                            preset='default'
                            tx='commonSave'
                            onPress={onSave}
                            disabled={!png || isRendering}
                            style={{marginLeft: spacing.small}}
                        />
                    </View>
                </>
            )}
        </ScrollView>
        {isSaving && <Loading />}
        {error && <ErrorModal error={error} />}
      </Screen>
    )
}

const $screen: ViewStyle = {flex: 1}

const $contentContainer: ViewStyle = {
    padding: spacing.small,
}

const $preview: ViewStyle = {
    alignSelf: 'center',
    width: scale(160),
    height: scale(170),
    justifyContent: 'center',
    marginVertical: spacing.medium,
}

const $previewImage = {
    width: scale(160),
    height: scale(170),
}

const $previewSpinner: ViewStyle = {
    position: 'absolute',
    alignSelf: 'center',
}

const $traits: ViewStyle = {
    flexDirection: 'row',
    flexWrap: 'wrap',
}

const $trait: ViewStyle = {
    width: '33.33%',
    alignItems: 'center',
    paddingVertical: spacing.large,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.medium,
}
