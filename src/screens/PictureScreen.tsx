import React, {useMemo, useState} from 'react'
import {Pressable, ScrollView, View, ViewStyle} from 'react-native'
import {SvgXml} from 'react-native-svg'
import {spacing, useThemeColor} from '../theme'
import {Button, ErrorModal, Header, Icon, IconTypes, Loading, Screen} from '../components'
import {useStores} from '../models'
import AppError from '../utils/AppError'
import {scale} from '@gocodingnow/rn-size-matters'
import {StaticScreenProps, useNavigation} from '@react-navigation/native'
import {useTabBarInset} from '../navigation/tabBarVisibility'
import {AVATAR_TRAITS, AvatarSelection, isValidAvatarSelection, randomAvatarSelection, renderAvatarSvg} from '../utils/avatar'

type Props = StaticScreenProps<undefined>

// Each tile steps one trait to its next value. Eyebrows are only touched by Random.
const TILES: {key: string, icon: IconTypes, label: string}[] = [
    {key: 'top', icon: 'faScissors', label: 'Hair or headwear'},
    {key: 'hairColor', icon: 'faPalette', label: 'Hair color'},
    {key: 'accessories', icon: 'faGlasses', label: 'Glasses'},
    {key: 'eyes', icon: 'faEye', label: 'Eyes'},
    {key: 'mouth', icon: 'faFaceSmile', label: 'Mouth'},
    {key: 'facialHair', icon: 'faMask', label: 'Facial hair'},
    {key: 'skinColor', icon: 'faEyeDropper', label: 'Skin'},
    {key: 'clothing', icon: 'faShirt', label: 'Clothes'},
    {key: 'clothesColor', icon: 'faFillDrip', label: 'Clothes color'},
]

export const PictureScreen = function PictureScreen({route}: Props) {
    const navigation = useNavigation()
    const {walletProfileStore} = useStores()
    const tabBarInset = useTabBarInset()

    const [error, setError] = useState<AppError | undefined>()
    const [isSaving, setIsSaving] = useState(false)
    const [selection, setSelection] = useState<AvatarSelection>(() =>
        isValidAvatarSelection(walletProfileStore.avatarSelection) ? walletProfileStore.avatarSelection : randomAvatarSelection()
    )
    const svg = useMemo(() => renderAvatarSvg(selection), [selection])

    const onTilePress = function (key: string) {
        const values = AVATAR_TRAITS[key]
        const next = values[(values.indexOf(selection[key]) + 1) % values.length]
        setSelection({...selection, [key]: next})
    }

    const onSave = async function () {
        try {
            setIsSaving(true)
            await walletProfileStore.updateAvatar(selection)
            setIsSaving(false)
            navigation.goBack()
        } catch (e: any) {
            setIsSaving(false)
            setError(e)
        }
    }

    const iconColor = useThemeColor('text')

    return (
      <Screen contentContainerStyle={$screen} preset='fixed'>
        <Header
            leftIcon='faArrowLeft'
            onLeftPress={() => navigation.goBack()}
            titleTx='profileScreen_changeAvatar'
        />
        <ScrollView contentContainerStyle={[$contentContainer, {paddingBottom: tabBarInset}]}>
            <View style={$preview}>
                <SvgXml xml={svg} width={scale(160)} height={scale(160)} />
            </View>
            <View style={$tiles}>
                {TILES.map(tile => (
                    <Pressable
                        key={tile.key}
                        style={({pressed}) => [$tile, pressed && {opacity: 0.5}]}
                        onPress={() => onTilePress(tile.key)}
                        accessibilityRole='button'
                        accessibilityLabel={tile.label}
                    >
                        <Icon icon={tile.icon} size={spacing.large} color={iconColor} />
                    </Pressable>
                ))}
            </View>
            <View style={$buttonContainer}>
                <Button
                    preset='secondary'
                    tx='pictureRandom'
                    LeftAccessory={() => <Icon icon='faDice' />}
                    onPress={() => setSelection(randomAvatarSelection())}
                />
                <Button
                    preset='default'
                    tx='commonSave'
                    onPress={onSave}
                    style={{marginLeft: spacing.small}}
                />
            </View>
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
    marginVertical: spacing.medium,
}

const $tiles: ViewStyle = {
    flexDirection: 'row',
    flexWrap: 'wrap',
}

const $tile: ViewStyle = {
    width: '33.33%',
    alignItems: 'center',
    paddingVertical: spacing.large,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.medium,
}
