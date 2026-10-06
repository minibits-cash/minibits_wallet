import {observer} from 'mobx-react-lite'
import React, {useEffect, useState} from 'react'
import {View, ViewStyle} from 'react-native'
import FastImage from 'react-native-fast-image'
import {Icon} from '../../components'
import {Contact, ContactKind} from '../../models/Contact'
import {colors, useThemeColor} from '../../theme'
import {getImageSource} from '../../utils/utils'

/**
 * Profile picture, or a placeholder: a bolt for lightning addresses, a user icon
 * otherwise. A picture that fails to load (dead url, server error) falls back to the
 * placeholder instead of leaving an empty circle.
 */
// observer: the picture can change under it (profile refresh) without the parent re-rendering
export const ContactAvatar = observer(function (props: {contact: Contact, size?: number, style?: ViewStyle}) {
    const {contact, size = 40, style} = props
    const placeholderBg = useThemeColor('card')
    const placeholderIcon = useThemeColor('textDim')
    const [isBroken, setIsBroken] = useState(false)

    // a refreshed picture url deserves a new attempt
    useEffect(() => setIsBroken(false), [contact.picture])

    if (contact.picture && !isBroken) {
        return (
            <FastImage
                style={[{width: size, height: size, borderRadius: size / 2}, style] as any}
                source={{uri: getImageSource(contact.picture)}}
                onError={() => setIsBroken(true)}
            />
        )
    }

    const isLightning = contact.kind === ContactKind.LIGHTNING

    return (
        <View
            style={[{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: placeholderBg,
                alignItems: 'center',
                justifyContent: 'center',
            }, style]}
        >
            <Icon
                icon={isLightning ? 'faBolt' : 'faCircleUser'}
                size={size * (isLightning ? 0.45 : 0.6)}
                color={isLightning ? colors.palette.orange200 : placeholderIcon}
                containerStyle={{padding: 0}}
            />
        </View>
    )
})
