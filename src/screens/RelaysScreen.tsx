import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useState} from 'react'
import {FlatList, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation' // @demo remove-current-line
import {Icon, ListItem, Screen, Text, Card} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import {translate} from '../i18n'
import { Env, log } from '../utils/logger'
import { round } from '../utils/number'
import EventEmitter from '../utils/eventEmitter'
import { Relay } from '../models/Relay'

interface SettingsScreenProps extends SettingsStackScreenProps<'Relays'> {}


export const RelaysScreen: FC<SettingsScreenProps> = observer(
  function RelaysScreen(_props) {
    const {navigation} = _props

    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })

    const {relaysStore} = useStores()

    
    const $itemRight = {color: useThemeColor('textDim')}
    const iconColor = useThemeColor('textDim')
    const headerBg = useThemeColor('header')
    
    return (
      <Screen style={$screen} preset='fixed'>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset='heading'
            text='Relays'
            style={{color: 'white'}}
          />
        </View>
        <View style={$contentContainer}>          
          <Card
            style={[$card, {marginTop: spacing.medium}]}
            ContentComponent={
              <>   
                <FlatList<Relay>
                    data={relaysStore.allRelays}
                    renderItem={({ item, index }) => {                                
                        return(
                            <ListItem
                                text={item.hostname}
                                subText={item.error}
                                leftIcon='faCircleNodes'
                                leftIconColor={iconColor as string}
                                topSeparator={index === 0 ? false : true}                                
                                RightComponent={
                                    <View style={$rightContainer}>
                                        {item.status === WebSocket.OPEN ? (
                                            <Icon icon='faCheckCircle' color={colors.palette.success200} />
                                        ) : (item.status === WebSocket.CLOSED ? (
                                            <Icon icon='faBan' color={colors.palette.angry500} />
                                        ) : (
                                            <Icon icon='faRotate' color={colors.palette.accent300} />
                                        ))}
                                    </View>
                                }
                                style={$item}
                            />
                        )
                    }}                
                    keyExtractor={(item) => item.url} 
                    style={{ flexGrow: 0 }}
                />  
                
              </>
            }
        />
        </View>
      </Screen>
    )
  },
)

const $screen: ViewStyle = {
  flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.1,
}

const $contentContainer: TextStyle = {
  // flex: 1,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $card: ViewStyle = {
  // marginVertical: 0,
}

const $item: ViewStyle = {
  // paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginLeft: spacing.small,
}

