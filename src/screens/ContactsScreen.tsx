import {observer} from 'mobx-react-lite'
import React, {FC} from 'react'
import {ViewStyle} from 'react-native'
import {spacing} from '../theme'
import {Card, Screen} from '../components'
import {TabScreenProps} from '../navigation' // @demo remove-current-line
import {useHeader} from '../utils/useHeader'

interface ContactsScreenProps extends TabScreenProps<'Contacts'> {}

export const ContactsScreen: FC<ContactsScreenProps> = observer(function ContactsScreen(_props) {    
    useHeader({}) // default header component

    return (
        <Screen contentContainerStyle={$screen}>
            <Card
                style={{margin: spacing.small}}
                content="Contact management has not been yet implemented"
            />
        </Screen>
    )
})

const $screen: ViewStyle = {
  // flex: 1,
  // backgroundColor: colors.background,
}
