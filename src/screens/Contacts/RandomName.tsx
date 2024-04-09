import {observer} from 'mobx-react-lite'
import React, {useEffect, useState} from 'react'
import {TextStyle, View, ViewStyle, InteractionManager, FlatList } from 'react-native'
import {spacing} from '../../theme'
import {Button, Card, ErrorModal, InfoModal, Loading, Screen, Text} from '../../components'
import {useStores} from '../../models'
import AppError, { Err } from '../../utils/AppError'
import {$sizeStyles} from '../../components/Text'
import {getRandomUsername} from '../../utils/usernames'
import { scale } from '@gocodingnow/rn-size-matters'
import { translate } from '../../i18n'


export const RandomName = observer(function (props: {navigation: any, pubkey: string}) {
    // const navigation = useNavigation()
    const {userSettingsStore, walletProfileStore} = useStores()
    const {navigation} = props

    const [randomNames, setRandomNames] = useState<string[]>([])
    const [selectedName, setSelectedName] = useState<string>('')    
    const [info, setInfo] = useState('')        
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const load = async () => {
            setIsLoading(true)
            InteractionManager.runAfterInteractions(async () => {
                let i = 0
                let names = []
                while(i < 8) {
                    const name = getRandomUsername()
                    names.push(name)
                    i++
                }             
                
                setRandomNames(names)
                setIsLoading(false)                
            })
        }
        load()
        return () => {}        
    }, [])

    const confirmSelectedName = async function () {
        if(!selectedName) {
            setInfo(translate("contactsScreen.randomName.selectOneOfUsernames"))
            return
        }
        
        try {
            setIsLoading(true)
            
            await walletProfileStore.updateName(selectedName)                                    
            
            setIsLoading(false)
            navigation.goBack()
            return
        } catch (e: any) {
            handleError(e)
        }                       
    }
    

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
// 
    return (
      <Screen contentContainerStyle={$screen}>
        <View style={$contentContainer}>
          <Card
            ContentComponent={
              <FlatList
                data={randomNames}
                numColumns={2}
                renderItem={({item, index}) => {
                  return (
                    <Button
                      key={index}
                      preset={selectedName === item ? 'default' : 'secondary'}
                      onPress={() => setSelectedName(item)}
                      text={`${item}`}
                      style={{minWidth: scale(150), margin: spacing.extraSmall}}
                      textStyle={$sizeStyles.xs}
                    />
                  )
                }}
                keyExtractor={item => item}
                style={{flexGrow: 0}}
              />
            }
            style={$card}
          />
          <View style={$buttonContainer}>
            <Button
              onPress={() => confirmSelectedName()}
              tx="common.confirm"
              style={{marginTop: spacing.medium, minWidth: 120}}
            />
          </View>
        </View>
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
        {isLoading && <Loading />}
      </Screen>
    )
  })



const $screen: ViewStyle = {}


const $contentContainer: TextStyle = {    
    padding: spacing.extraSmall,  
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
}

const $bottomContainer: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',
    marginBottom: spacing.medium,
    alignSelf: 'stretch',
    // opacity: 0,
  }

const $card: ViewStyle = {
    marginBottom: 0,
}
