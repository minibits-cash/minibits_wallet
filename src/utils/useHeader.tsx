import React, {useLayoutEffect} from 'react'
import {useNavigation} from '@react-navigation/native'
import {Header, HeaderProps} from '../components'

/**
 * A hook that can be used to easily set the Header of a react-navigation screen from within the screen's component.
 *
 */
export function useHeader(headerProps: HeaderProps, deps: any[] = []) {
  const navigation = useNavigation()

  /* eslint-disable react-hooks/exhaustive-deps */
  useLayoutEffect(() => {
    navigation.setOptions({
        headerShown: true,
        header: () => <Header {...headerProps} />,
    })
  }, deps)
  /* eslint-enable */
}
