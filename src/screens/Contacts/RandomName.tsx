import {observer} from 'mobx-react-lite'
import React, {useEffect, useState} from 'react'
import {TextStyle, View, ViewStyle, InteractionManager } from 'react-native'
import {spacing} from '../../theme'
import {Button, Card, ErrorModal, InfoModal, Loading, Screen, Text} from '../../components'
import {useStores} from '../../models'
import AppError, { Err } from '../../utils/AppError'
import {$sizeStyles} from '../../components/Text'
import {getRandomUsername} from '../../utils/usernames'


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
            setInfo('Select one of the usernames')
            return
        }
        
        try {
            setIsLoading(true)
            
            await walletProfileStore.update(selectedName, walletProfileStore.picture)                                    
            userSettingsStore.setWalletId(selectedName)

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

    return (
      <Screen style={$screen} preset='auto'>
        <View style={$contentContainer}>
            <Card
                style={$card}
                heading='Choose a random name'
                headingStyle={{textAlign: 'center'}}
                ContentComponent={
                <View style={$namesContainer}>                
                    {randomNames.map((name, index) => (
                        <Button
                            key={index}
                            preset={selectedName === name ? 'default' : 'secondary'}
                            onPress={() => setSelectedName(name)}
                            text={`${name}`}
                            style={{minWidth: 150, margin: spacing.extraSmall}}
                            textStyle={$sizeStyles.xs}
                        />)
                    )}
                    {isLoading && <Loading />}                               
                </View>
                }
                FooterComponent={
                    <View style={{alignItems: 'center'}}>
                        <Button                        
                            onPress={() => confirmSelectedName()}
                            text={'Confirm'}
                            style={{margin: spacing.extraSmall, minWidth: 120}}                        
                        />
                    </View>
                }           
            />            
        </View>        
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
 
      </Screen>
    )
  })



const $screen: ViewStyle = {}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    paddingHorizontal: spacing.medium,
    height: spacing.screenHeight * 0.08,
    justifyContent: 'space-around',
}

const $contentContainer: TextStyle = {    
    padding: spacing.extraSmall,  
}

const $namesContainer: ViewStyle = {
    // flex: 1,
    height: spacing.screenHeight * 0.35,    
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.medium,
    paddingTop: spacing.medium,    
}

const $card: ViewStyle = {
    marginBottom: 0,
}
