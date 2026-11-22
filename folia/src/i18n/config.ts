import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import zh from './locales/zh-CN';
i18n.use(initReactI18next).init({lng:'zh-CN',resources:{'zh-CN':{translation:zh}},interpolation:{escapeValue:false}});
export default i18n;
