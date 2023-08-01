import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {ViewStyle} from 'react-native'
import * as nostrTools from 'nostr-tools'
import {spacing} from '../theme'
import {Card, Screen} from '../components'
import {useHeader} from '../utils/useHeader'
import { TabScreenProps } from '../navigation'

interface ContactsScreenProps extends TabScreenProps<'Contacts'> {}

export const ContactsScreen: FC<ContactsScreenProps> = observer(function ContactsScreen(_props) {    
    useHeader({}) // default header component

    const [privateKey, setPrivateKey] = useState<string>('')
    const [publicKey, setPublicKey] = useState<string>('')

    useEffect(() => {
        let sk = nostrTools.generatePrivateKey() // `sk` is a hex string
        let pk = nostrTools.getPublicKey(sk)

        setPrivateKey(sk)
        setPublicKey(pk)
        
    }, [])

    return (
        <Screen contentContainerStyle={$screen}>
            <Card
                style={{margin: spacing.small}}
                content={`Public key: ${publicKey}`}
            />
            <Card
                style={{margin: spacing.small}}
                content={`Private key: ${privateKey}`}
            />
        </Screen>
    )
})

const $screen: ViewStyle = {
  // flex: 1,
  // backgroundColor: colors.background,
}
