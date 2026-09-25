import React, { useState, useEffect, useCallback } from 'react';
import {
  SafeAreaView, View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, StatusBar, Alert, Share
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

// ---------- DANE ----------
const TORQUE = {
  '2T': [['Świeca zapłonowa', '12-15'], ['Głowica cylindra (na krzyż)', '18-20'], ['Koło magnetowe', '40-50'], ['Śruby miski/pokrywy', '8-10'], ['Nakrętka koła zębatego', '35-45']],
  '4T': [['Świeca zapłonowa', '20-25'], ['Śruby głowicy (na krzyż, etapami)', '25-30'], ['Śruba spustowa oleju', '20-25'], ['Nakrętka koła zamachowego', '50-60'], ['Śruby miski olejowej', '9-11']],
  'CVT': [['Nakrętka koła pasowego (przód)', '40-50'], ['Nakrętka sprzęgła (tył)', '55-65'], ['Śruby pokrywy CVT', '9-11'], ['Śruba koła pasowego wtórnego', '40-45']],
};

const WIRING = {
  '2T': {
    obwody: [
      ['Zapłon (magneto)', 'Cewka zapłonowa → kondensator → przerywacz/CDI → świeca. W starszych modelach brak akumulatora — zapłon zasilany bezpośrednio z cewki.'],
      ['Oświetlenie (AC z cewki)', 'Osobna cewka oświetleniowa w alternatorze zasila światła bezpośrednio prądem zmiennym — jasność zależy od obrotów silnika.'],
      ['Rozrusznik / kick-start', 'W wersjach z rozrusznikiem elektrycznym: akumulator → bezpiecznik → przekaźnik → silnik rozrusznika.'],
    ],
    kolory: [['Czarny', 'Masa (–)'], ['Żółty', 'Ładowanie / oświetlenie z cewki (AC)'], ['Niebiesko-biały', 'Impuls zapłonu do CDI'], ['Czerwony', 'Plus stały z akumulatora (jeśli występuje)']],
  },
  '4T': {
    obwody: [
      ['Ładowanie', 'Alternator (3-fazowy AC) → prostownik/regulator napięcia → akumulator. Najczęstsza przyczyna braku ładowania: uszkodzony regulator.'],
      ['Zapłon (CDI/ECU)', 'Czujnik położenia wału → moduł CDI/ECU → cewka zapłonowa → świeca.'],
      ['Rozrusznik', 'Akumulator → bezpiecznik główny → stycznik rozrusznika → silnik rozrusznika → masa.'],
      ['Wtrysk (jeśli występuje)', 'ECU steruje pompą paliwa, wtryskiwaczem i przepustnicą na podstawie czujników (TPS, temperatura, obroty).'],
    ],
    kolory: [['Żółty (x3)', 'Fazy alternatora (AC, przed prostownikiem)'], ['Zielony', 'Masa'], ['Czerwony', 'Plus stały z akumulatora'], ['Różowy/brązowy', 'Zasilanie po stacyjce']],
  },
  'CVT': {
    obwody: [
      ['Ładowanie', 'Jak w 4T: alternator → regulator/prostownik → akumulator. Skutery są bardziej czułe na spadek napięcia (dużo elektroniki).'],
      ['Immobilizer / blokada kierownicy', 'Cewka w stacyjce komunikuje się z modułem — uszkodzenie uniemożliwia odpalenie mimo sprawnego zapłonu.'],
      ['Czujniki CVT (wybrane modele)', 'Niektóre skutery mają czujnik prędkości/obrotów wtórnego koła pasowego do komputera pokładowego.'],
      ['Zapłon (CDI/ECU)', 'Jak w 4T — moduł steruje momentem zapłonu na podstawie czujnika położenia wału.'],
    ],
    kolory: [['Żółty', 'Fazy ładowania (AC)'], ['Zielony/czarny', 'Masa'], ['Czerwony', 'Plus stały z akumulatora'], ['Niebieski', 'Sygnał immobilizera (jeśli występuje)']],
  },
};



// ---------- ROZBUDOWANA DIAGNOSTYKA KROK PO KROKU ----------
const DIAG_FLOWS = {
  noSpark: {
    title: 'Brak iskry na świecy',
    steps: [
      { q: 'Wykręć świecę, oprzyj gwint o masę silnika i zakręć rozrusznikiem. Czy jest wyraźna iskra?', yes: 'spark', no: 'coilPower', warn: 'Nie trzymaj przewodu WN gołą ręką.' },
      { id: 'coilPower', q: 'Sprawdź zasilanie cewki i masę zgodnie ze schematem DTR. Czy zasilanie/masa są prawidłowe?', yes: 'pickup', no: 'wiring', expected: 'Wartość zależna od typu CDI/ECU.' },
      { id: 'pickup', q: 'Sprawdź impulsator/pickup oraz jego przewody. Czy sygnał lub rezystancja mieści się w DTR?', yes: 'cdi', no: 'pickupRepair', expected: 'Użyj specyfikacji konkretnego silnika.' },
      { id: 'cdi', q: 'Czy przewód gaszenia (kill) nie zwiera zapłonu do masy?', yes: 'cdi', no: 'killRepair' },
      { id: 'wiring', q: 'Sprawdź bezpiecznik, złącza, masę silnika i przewód WN. Czy znalazłeś przerwę lub zwarcie?', yes: 'wiringRepair', no: 'cdi' },
      { id: 'spark', result: 'ISKRA JEST', detail: 'Układ zapłonowy podstawowo reaguje. Przejdź do paliwa, kompresji i ustawienia zapłonu.' },
      { id: 'pickupRepair', result: 'PODEJRZENIE: IMPULSATOR / JEGO OKABLOWANIE', detail: 'Napraw lub wymień element dopiero po potwierdzeniu pomiaru wg DTR.' },
      { id: 'killRepair', result: 'PODEJRZENIE: OBWÓD KILL SWITCH / STACYJKA', detail: 'Szukaj zwarcia przewodu gaszenia do masy.' },
      { id: 'wiringRepair', result: 'PODEJRZENIE: INSTALACJA', detail: 'Usuń przerwę, korozję lub słabą masę i ponów próbę iskry.' },
      { id: 'cdi', result: 'PODEJRZENIE: CDI / ECU / CEWKA', detail: 'Nie wymieniaj części w ciemno. Potwierdź zasilanie, masy, pickup i przewody.' }
    ]
  },
  charging: {
    title: 'Brak / słabe ładowanie',
    steps: [
      { q: 'Zmierz napięcie akumulatora po postoju. Czy jest około 12,5 V lub więcej?', yes: 'running', no: 'battery' },
      { id: 'running', q: 'Uruchom silnik i zmierz napięcie na akumulatorze. Czy rośnie do ok. 13,8–14,6 V?', yes: 'good', no: 'stator' },
      { id: 'stator', q: 'Sprawdź AC z alternatora/statora oraz ciągłość przewodów według DTR. Czy stator daje prawidłowy sygnał?', yes: 'regulator', no: 'statorRepair' },
      { id: 'regulator', q: 'Sprawdź regulator, masę i złącza. Czy regulator jest prawidłowo zasilany i ma dobrą masę?', yes: 'regRepair', no: 'wiringRepair2' },
      { id: 'battery', result: 'AKUMULATOR ROZŁADOWANY / DO SPRAWDZENIA', detail: 'Naładuj i wykonaj ponowny pomiar. Niskie napięcie nie potwierdza jeszcze uszkodzenia akumulatora.' },
      { id: 'good', result: 'ŁADOWANIE W ZAKRESIE KONTROLNYM', detail: 'Układ ładowania wygląda prawidłowo w tym teście.' },
      { id: 'statorRepair', result: 'PODEJRZENIE: STATOR / ALTERNATOR', detail: 'Potwierdź pomiarem wg DTR konkretnego silnika.' },
      { id: 'regRepair', result: 'PODEJRZENIE: REGULATOR NAPIĘCIA', detail: 'Sprawdź także temperaturę, masę i stan złączy.' },
      { id: 'wiringRepair2', result: 'PODEJRZENIE: OKABLOWANIE / MASA', detail: 'Oczyść i zabezpiecz połączenia, potem ponów pomiar.' }
    ]
  },
  starter: {
    title: 'Rozrusznik tylko klika / nie kręci',
    steps: [
      { q: 'Czy światła/kontrolki wyraźnie przygasają przy próbie rozruchu?', yes: 'battery', no: 'relay' },
      { id: 'battery', q: 'Zmierz napięcie akumulatora podczas rozruchu. Czy nie spada nadmiernie?', yes: 'starter', no: 'batteryRepair', expected: 'Dokładny próg zależy od układu i akumulatora; porównaj z DTR.' },
      { id: 'relay', q: 'Czy na wejściu/wyjściu przekaźnika rozrusznika pojawia się prawidłowe napięcie podczas START?', yes: 'starter', no: 'relayRepair' },
      { id: 'starter', q: 'Czy rozrusznik ma dobrą masę i połączenie plusowe, a silnik rozrusznika nie jest zablokowany?', yes: 'starterRepair', no: 'wiringRepair3' },
      { id: 'batteryRepair', result: 'PODEJRZENIE: AKUMULATOR', detail: 'Naładuj/przetestuj akumulator pod obciążeniem i sprawdź klemy.' },
      { id: 'relayRepair', result: 'PODEJRZENIE: PRZEKAŹNIK / STEROWANIE STARTEM', detail: 'Sprawdź bezpiecznik, stacyjkę, czujniki blokady i przekaźnik.' },
      { id: 'starterRepair', result: 'PODEJRZENIE: ROZRUSZNIK', detail: 'Sprawdź szczotki, komutator, łożyska i mechaniczne zablokowanie.' },
      { id: 'wiringRepair3', result: 'PODEJRZENIE: PRZEWODY / MASA', detail: 'Sprawdź spadek napięcia na przewodzie plusowym i masowym.' }
    ]
  },
  compression: {
    title: 'Podejrzenie niskiej kompresji',
    steps: [
      { q: 'Czy silnik ma wyraźnie mniejszy opór podczas kręcenia niż zwykle?', yes: 'test', no: 'other' },
      { id: 'test', q: 'Wykonaj próbę kompresji zgodnie z procedurą dla danego silnika. Czy wynik jest poza zakresem DTR?', yes: 'wet', no: 'other' },
      { id: 'wet', q: 'Wykonaj próbę olejową. Czy po dodaniu niewielkiej ilości oleju wynik wyraźnie wzrasta?', yes: 'rings', no: 'valves' },
      { id: 'rings', result: 'PODEJRZENIE: PIERŚCIENIE / CYLINDER / TŁOK', detail: 'Wymaga dalszej kontroli mechanicznej.' },
      { id: 'valves', result: 'PODEJRZENIE: ZAWORY / USZCZELNIENIE GŁOWICY', detail: 'Sprawdź luz zaworowy i szczelność zgodnie z DTR.' },
      { id: 'other', result: 'KOMPRESJA NIE POTWIERDZA USTERKI W TYM TEŚCIE', detail: 'Sprawdź zapłon, paliwo, dolot i ustawienie rozrządu.' }
    ]
  }
};

const DIAG_TREE = [
  { label: 'Silnik nie odpala', children: [
    { label: 'W ogóle nie reaguje (rozrusznik/kick nic nie robi)', causes: ['Rozładowany akumulator', 'Przepalony bezpiecznik główny', 'Przerwany obwód masy', 'Uszkodzony stycznik rozrusznika'] },
    { label: 'Kręci, ale nie zapala', children: [
      { label: 'Brak iskry na świecy', causes: ['Uszkodzona cewka zapłonowa', 'Uszkodzony moduł CDI', 'Zwarcie w przewodzie wysokiego napięcia', 'Uszkodzony wyłącznik awaryjny (kill switch)'] },
      { label: 'Jest iskra, ale nie chce zapalić', causes: ['Zalany gaźnik/wtryskiwacz', 'Brak paliwa w komorze pływakowej', 'Zapchany filtr paliwa', 'Zła mieszanka paliwowa (2T)'] },
    ]},
    { label: 'Odpala i od razu gaśnie', causes: ['Zbyt uboga/bogata mieszanka biegu jałowego', 'Nieszczelność kolektora ssącego', 'Zapchany filtr powietrza'] },
    { label: 'Rozrusznik kręci bardzo wolno', causes: ['Słaby/rozładowany akumulator', 'Zużyte szczotki rozrusznika', 'Zła masa silnik-rama'] },
  ]},
  { label: 'Silnik dymi', children: [
    { label: 'Dym niebieszawy', causes: ['Zużyte pierścienie tłokowe', 'Zbyt bogata mieszanka oleju (2T)', 'Zużyte uszczelniacze wałka korbowego'] },
    { label: 'Dym biały (gęsty)', causes: ['Woda w komorze spalania', 'Uszkodzona uszczelka pod głowicą', 'Kondensacja przy zimnym rozruchu (norma w małej ilości)'] },
    { label: 'Dym czarny', causes: ['Zbyt bogata mieszanka', 'Zapchany filtr powietrza', 'Źle ustawiony gaźnik/wtrysk'] },
  ]},
  { label: 'Nierówna praca / gaśnie na jałowym', children: [
    { label: 'Tylko na zimnym silniku', causes: ['Zła regulacja ssania/chokea', 'Zbyt uboga mieszanka rozruchowa'] },
    { label: 'Tylko na gorącym silniku', causes: ['Nieszczelność podciśnieniowa', 'Zapowietrzenie układu paliwowego', 'Źle wyregulowane zawory (4T)'] },
  ]},
  { label: 'Przegrzewanie się silnika', children: [
    { label: 'Chłodzenie cieczą', causes: ['Niski poziom płynu chłodzącego', 'Zapchany radiator', 'Uszkodzona pompa wody', 'Wadliwy termostat'] },
    { label: 'Chłodzenie powietrzem', causes: ['Zabrudzone żeberka cylindra', 'Zbyt uboga mieszanka', 'Zły kąt wyprzedzenia zapłonu'] },
  ]},
  { label: 'CVT: szarpanie / poślizg / słabe przyspieszenie', children: [
    { label: 'Szarpanie przy ruszaniu', causes: ['Zużyte okładziny sprzęgła odśrodkowego', 'Zaolejone sprzęgło'] },
    { label: 'Poślizg paska przy przyspieszaniu', causes: ['Rozciągnięty/zużyty pasek CVT', 'Zużyte rolki wariatora', 'Zaolejony pasek'] },
    { label: "Silnik 'wyje' bez przełożenia mocy", causes: ['Zerwany pasek CVT', 'Uszkodzone sprzęgło jednokierunkowe (startowe)'] },
  ]},
  { label: 'Elektryka: brak zasilania / kontrolki', children: [
    { label: 'Nic się nie świeci', causes: ['Przepalony bezpiecznik główny', 'Rozładowany/uszkodzony akumulator', 'Przerwana masa'] },
    { label: 'Akumulator się nie ładuje', causes: ['Uszkodzony regulator napięcia', 'Zużyte szczotki alternatora', 'Luźne złącze ładowania'] },
    { label: 'Pojedyncza kontrolka/element nie działa', causes: ['Przepalona żarówka/dioda', 'Lokalnie przepalony bezpiecznik', 'Uszkodzone złącze'] },
  ]},
  { label: 'Hamulce', children: [
    { label: 'Piszczą / zgrzytają podczas hamowania', causes: ['Zużyte klocki/okładziny (do wymiany)', 'Zabrudzona/zaszklona tarcza', 'Brak smaru na sworzniach zacisku'] },
    { label: 'Dźwignia/pedał hamulca jest miękki, gąbczasty', causes: ['Powietrze w układzie (odpowietrzyć)', 'Wyciek płynu hamulcowego', 'Zużyty przewód hamulcowy'] },
    { label: 'Hamulec ciągnie w jedną stronę', causes: ['Zapieczony tłoczek zacisku', 'Nierówne zużycie klocków', 'Zapowietrzony jeden obwód'] },
  ]},
  { label: 'Dziwne dźwięki / stukanie', children: [
    { label: 'Metaliczne stukanie z silnika', causes: ['Luz na sworzniu tłokowym', 'Zużyty łańcuch/napinacz rozrządu', 'Zbyt niski poziom oleju'] },
    { label: 'Stukanie z zawieszenia przy nierównościach', causes: ['Zużyte tuleje wahacza', 'Poluzowane mocowanie amortyzatora', 'Uszkodzony łącznik stabilizatora'] },
    { label: 'Pisk paska napędowego/generatora', causes: ['Zużyty lub rozciągnięty pasek', 'Nieprawidłowy naciąg paska', 'Zaolejony pasek'] },
  ]},
  { label: 'Zapach spalin / paliwa', children: [
    { label: 'Silny zapach benzyny przy postoju', causes: ['Wyciek z przewodu paliwowego', 'Nieszczelny korek/odpowietrznik baku', 'Przelewający się gaźnik'] },
    { label: 'Zapach spalin czuć podczas jazdy', causes: ['Nieszczelność w układzie wydechowym', 'Pęknięty kolektor wydechowy', 'Uszkodzona uszczelka tłumika'] },
  ]},
  { label: 'Sprzęgło (jednostki manualne)', children: [
    { label: 'Sprzęgło się ślizga (silnik "podkręca", brak mocy)', causes: ['Zużyte okładziny sprzęgła', 'Rozregulowany mechanizm sprzęgła', 'Zaolejone tarcze cierne'] },
    { label: 'Sprzęgło łapie bardzo wysoko lub nisko', causes: ['Rozregulowana linka/hydraulika sprzęgła', 'Powietrze w układzie hydraulicznym', 'Zużyta linka sprzęgłowa'] },
  ]},
  { label: 'Skrzynia biegów (manualna)', children: [
    { label: 'Trudno wrzucić bieg', causes: ['Rozregulowane sprzęgło', 'Zbyt gęsty/niewłaściwy olej przekładniowy', 'Zużyty mechanizm zmiany biegów'] },
    { label: 'Bieg samoczynnie wypada', causes: ['Zużyte widełki zmiany biegów', 'Zużyte zęby sprzęgające koła zębatego', 'Poluzowany mechanizm selektora'] },
    { label: 'Głośna praca skrzyni (wycie/zgrzyty)', causes: ['Niski poziom oleju przekładniowego', 'Zużyte łożyska skrzyni', 'Zużyte koła zębate'] },
  ]},
  { label: 'Opony i koła', children: [
    { label: 'Wibracje przy większej prędkości', causes: ['Niewyważone koło', 'Uszkodzona/odkształcona felga', 'Zużyta lub uszkodzona opona'] },
    { label: 'Nierówne zużycie bieżnika', causes: ['Złe ciśnienie w oponie', 'Zły kąt geometrii/ustawienia zawieszenia', 'Uszkodzone łożysko koła'] },
    { label: 'Koło "bije", kierownica drży', causes: ['Niewyważone koło', 'Wygięta oś/widelec', 'Luz na łożysku koła'] },
  ]},
  { label: 'Układ kierowniczy', children: [
    { label: 'Wyczuwalny luz na kierownicy', causes: ['Poluzowany stery główki ramy', 'Zużyte łożyska kierowania', 'Luz w przegubach układu kierowniczego'] },
    { label: 'Kierownica skręca się ciężko', causes: ['Zbyt mocno dokręcone łożyska stery', 'Brak smarowania łożysk stery', 'Zbyt niskie ciśnienie w oponie przedniej'] },
  ]},
  { label: 'Kontrolka silnika / błąd na wyświetlaczu', children: [
    { label: 'Kontrolka świeci światłem ciągłym', causes: ['Zapisany kod usterki czujnika (do odczytu skanerem OBD)', 'Luźne złącze czujnika', 'Nieszczelność układu (np. lambda/powietrze)'] },
    { label: 'Kontrolka miga', causes: ['Poważniejsza usterka zapłonu/wtrysku — unikać dalszej jazdy', 'Możliwe uszkodzenie katalizatora przy dalszej eksploatacji'] },
  ]},
  { label: 'Głośna praca układu wydechowego', children: [
    { label: 'Warkot/terkotanie na całym zakresie obrotów', causes: ['Nieszczelność między kolektorem a tłumikiem', 'Przerdzewiała komora tłumika', 'Poluzowane mocowanie wydechu'] },
    { label: 'Trzaski/strzały przy zwalnianiu gazu', causes: ['Zbyt uboga mieszanka', 'Nieszczelność na dolocie powietrza', 'Źle ustawiony zapłon'] },
  ]},
];

const ELECTRIC_CHECKS = [
  'Akumulator: napięcie spoczynkowe min. 12.5V',
  'Ładowanie: 13.8-14.6V na biegu jałowym',
  'Bezpieczniki: sprawdź ciągłość, nie na wygląd',
  'Masa: styki czyste, dokręcone, bez korozji',
  'Regulator napięcia: częsta przyczyna braku ładowania',
  'Cewka zapłonowa: rezystancja wg DTR',
];

const PARTS_PRICES = [
  ['Klocki hamulcowe', 35, 65, 110], ['Filtr powietrza', 20, 40, 80], ['Świeca zapłonowa', 15, 30, 55],
  ['Pasek CVT', 35, 70, 120], ['Rolki wariatora (komplet)', 30, 60, 100], ['Olej silnikowy 1L', 18, 32, 50],
  ['Bezpieczniki (zestaw)', 10, 18, 30], ['Uszczelka pod głowicę', 25, 45, 75],
];

const FREE_VIN_LIMIT = 3;
const PRO_PRICE = '19 zł/mies.';
const PLAN_FEATURES = [
  ['Kalkulator mieszanki 2T', true, true],
  ['Diagnostyka, momenty dokręcania, instalacje', true, true],
  ['Czarna Skrzynka / Notatnik', `do ${FREE_VIN_LIMIT} pojazdów (VIN)`, 'bez limitu'],
  ['Zdjęcia w kartotekach pojazdu', false, 'wkrótce'],
  ['Generator raportu PDF dla klienta', false, 'wkrótce'],
  ['Magazyn części z kalkulacją marży', false, 'wkrótce'],
];

const CHECKLIST_ITEMS = [
  'Poziom i stan oleju silnikowego', 'Naciąg i stan łańcucha/paska napędu', 'Ciśnienie i stan opon',
  'Działanie hamulców (przód/tył)', 'Luz na łożyskach kół', 'Stan i naciąg linek/hydrauliki sprzęgła',
  'Działanie oświetlenia i sygnału', 'Poziom płynu chłodzącego/hamulcowego',
  'Stan i naciąg paska CVT (jeśli dotyczy)', 'Dokręcenie kluczowych śrub (patrz: Dane/Nm)',
];

const REWARDS = [
  { pts: 10, label: '5% zniżki na następną usługę' },
  { pts: 25, label: 'Darmowa wymiana świecy' },
  { pts: 50, label: 'Darmowy przegląd podstawowy' },
  { pts: 100, label: '15% zniżki na części' },
];


// ---------- PROFILE KONKRETNYCH SILNIKÓW ----------
const ENGINE_PROFILES = [
  {id:'am6', name:'Minarelli AM6', family:'2T / manual', info:'6-biegowy 2T, popularny w motorowerach z manualną skrzynią.', torque:[['Świeca','12–15 Nm'],['Głowica','12–14 Nm'],['Koło magnetowe','40–45 Nm'],['Nakrętka sprzęgła','45–50 Nm']], checks:['iskra / CDI / pickup','kompresja','gaźnik i dolot','olej przekładniowy','luz i regulacja sprzęgła']},
  {id:'mh', name:'Minarelli Horizontal', family:'2T / CVT', info:'Poziomy Minarelli stosowany w wielu skuterach.', torque:[['Świeca','12–15 Nm'],['Wariator','40–45 Nm'],['Dzwon sprzęgła','40–45 Nm'],['Spust przekładni','15 Nm']], checks:['pasek i rolki CVT','sprzęgło','gaźnik / podciśnienie','stator / CDI','przekładnia końcowa']},
  {id:'piaggio', name:'Piaggio Hi-Per2', family:'2T / CVT', info:'2T Piaggio z przekładnią CVT.', torque:[['Świeca','12–15 Nm'],['Wariator','45–50 Nm'],['Dzwon sprzęgła','45–50 Nm'],['Koło magnetowe','40 Nm']], checks:['CVT','gaźnik / dolot','zapłon','ładowanie','przekładnia']},
  {id:'gy50', name:'GY6 50', family:'4T / CVT', info:'Chiński 4T 50 cm³, najczęściej z automatycznym CVT.', torque:[['Świeca','12–15 Nm'],['Wariator','55–60 Nm'],['Dzwon sprzęgła','50–55 Nm'],['Nakrętki głowicy','22–25 Nm']], checks:['luz zaworowy','olej silnikowy','CVT','ładowanie','gaźnik / podciśnienie']},
  {id:'gy125', name:'GY6 125/150', family:'4T / CVT', info:'Popularna rodzina 4T 125/150 cm³.', torque:[['Świeca','12–15 Nm'],['Wariator','55–60 Nm'],['Dzwon sprzęgła','50–55 Nm'],['Nakrętki głowicy','22–25 Nm']], checks:['luz zaworowy','rozrząd','olej','CVT','ładowanie']},
  {id:'zongshen', name:'Zongshen 125/250', family:'4T / manual', info:'Jednocylindrowe 4T stosowane m.in. w lekkich motocyklach.', torque:[['Świeca','wg DTR'],['Głowica','wg DTR'],['Spust oleju','20 Nm orientacyjnie'],['Mocowanie silnika','45 Nm orientacyjnie']], checks:['luz zaworowy','łańcuch rozrządu','olej','sprzęgło','ładowanie']},
];

const MULTIMETER_PROCEDURES = [
 {title:'Akumulator — napięcie spoczynkowe',steps:['Wyłącz silnik i odbiorniki.','Ustaw multimetr na V DC.','Czerwony przewód na + akumulatora, czarny na −.','Odczytaj napięcie po postoju.'],expected:'Około 12,5 V lub więcej zwykle wskazuje na naładowany akumulator; interpretuj wg typu akumulatora.'},
 {title:'Ładowanie — test na pracującym silniku',steps:['Zmierz napięcie na akumulatorze przed uruchomieniem.','Uruchom silnik i wykonaj pomiar na biegu jałowym.','Powtórz przy podwyższonych obrotach.','Włącz światła i ponów pomiar pod obciążeniem.'],expected:'Typowy zakres kontrolny instalacji 12 V to około 13,8–14,6 V, ale sprawdź DTR konkretnego pojazdu.'},
 {title:'Stator — uzwojenia',steps:['Odłącz złącze statora zgodnie z DTR.','Pomiar rezystancji wykonuj na wyłączonym zapłonie.','Porównaj pary przewodów między sobą i z masą.','Jeżeli DTR przewiduje pomiar AC, wykonaj go podczas kręcenia/ pracy silnika.'],expected:'Nie ma jednej uniwersalnej rezystancji — użyj wartości producenta.'},
 {title:'Cewka zapłonowa',steps:['Odłącz cewkę zgodnie z DTR.','Zmierz uzwojenie pierwotne.','Zmierz uzwojenie wtórne zgodnie z instrukcją producenta.','Sprawdź także fajkę, przewód WN i masę.'],expected:'Rezystancje są zależne od konstrukcji; nie oceniaj części tylko po jednej wartości.'},
 {title:'Impulsator / pickup',steps:['Odłącz złącze pickup.','Zmierz rezystancję, jeśli przewiduje ją DTR.','W razie potrzeby zmierz napięcie AC podczas kręcenia.','Sprawdź przewody pod kątem przerwy i zwarcia do masy.'],expected:'Parametry zależą od konkretnego układu CDI/ECU.'},
 {title:'Ciągłość przewodu',steps:['Wyłącz zapłon i odłącz zasilanie badanego obwodu.','Ustaw multimetr na ciągłość/Ω.','Zmierz oba końce przewodu.','Poruszaj wiązką podczas pomiaru, aby wykryć przerywanie.'],expected:'Dla sprawnego przewodu opór powinien być bardzo niski; dokładny próg zależy od długości i połączeń.'},
 {title:'Spadek napięcia — masa',steps:['Uruchom obwód pod obciążeniem.','Ustaw V DC.','Zmierz między minusem akumulatora a obudową badanego odbiornika.','Powtórz podczas rozruchu lub pracy dużego odbiornika.'],expected:'Im mniejszy spadek, tym lepiej. Wysoki spadek wskazuje na problem z masą/połączeniem.'},
];

// ---------- STORAGE ----------
const load = async (key, fallback = []) => {
  try { const v = await AsyncStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
};
const save = async (key, val) => { try { await AsyncStorage.setItem(key, JSON.stringify(val)); } catch (e) {} };

// ---------- UI HELPERS ----------
const Btn = ({ onPress, children, style }) => (
  <TouchableOpacity style={[s.btn, style]} onPress={onPress}><Text style={s.btnText}>{children}</Text></TouchableOpacity>
);
const Card = ({ title, children }) => (
  <View style={s.card}>{title ? <Text style={s.h2}>{title}</Text> : null}{children}</View>
);
const Entry = ({ title, sub, children }) => (
  <View style={s.entry}>{title ? <Text style={s.entryTitle}>{title}</Text> : null}{sub ? <Text style={s.entrySub}>{sub}</Text> : null}{children}</View>
);

export default function App() {
  const [view, setView] = useState('home');
  const [notes, setNotes] = useState([]);
  const [logs, setLogs] = useState([]);
  const [shop, setShop] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [points, setPoints] = useState(0);
  const [diagStack, setDiagStack] = useState([DIAG_TREE]);
  const [diagCrumbs, setDiagCrumbs] = useState(['Diagnostyka']);
  const [diagLeaf, setDiagLeaf] = useState(null);
  const [engineType, setEngineType] = useState('2T');
  const [query, setQuery] = useState('');
  const [noteVin, setNoteVin] = useState(''); const [noteText, setNoteText] = useState('');
  const [logVin, setLogVin] = useState(''); const [logDesc, setLogDesc] = useState('');
  const [submitText, setSubmitText] = useState(''); const [submitName, setSubmitName] = useState('');
  const [mixLiters, setMixLiters] = useState(''); const [mixRatio, setMixRatio] = useState(40);
  const [reminders, setReminders] = useState([]);
  const [remVin, setRemVin] = useState(''); const [remDesc, setRemDesc] = useState(''); const [remDate, setRemDate] = useState('');
  const [checkDone, setCheckDone] = useState([]);
  const [isPro, setIsPro] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [repairs, setRepairs] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [vehicleForm, setVehicleForm] = useState({ vin:'', brand:'', model:'', year:'', engine:'', mileage:'', mods:'', notes:'' });
  const [repairForm, setRepairForm] = useState({ symptom:'', diagnosis:'', repair:'', parts:'', cost:'', mileage:'', notes:'' });
  const [diagFlowId, setDiagFlowId] = useState(null);
  const [diagStepId, setDiagStepId] = useState(null);
  const [diagHistory, setDiagHistory] = useState([]);
  const [engineProfileId, setEngineProfileId] = useState('am6');
  const [meterProcedure, setMeterProcedure] = useState(null);

  useEffect(() => {
    (async () => {
      setNotes(await load('naprawnik_notes'));
      setLogs(await load('naprawnik_log'));
      setShop(await load('naprawnik_shop'));
      setSubmissions(await load('naprawnik_submissions'));
      setPoints((await load('naprawnik_points', [0]))[0] || 0);
      setReminders(await load('naprawnik_reminders'));
      setCheckDone(await load('naprawnik_checklist_done'));
      setIsPro((await load('naprawnik_pro', [false]))[0] || false);
      setVehicles(await load('naprawnik_vehicles'));
      setRepairs(await load('naprawnik_repairs'));
      setDiagHistory(await load('naprawnik_diag_history'));
    })();
  }, []);

  const goHome = () => setView('home');
  const openDiag = () => { setDiagStack([DIAG_TREE]); setDiagCrumbs(['Diagnostyka']); setDiagLeaf(null); setView('diag'); };
  const diagSelect = (node) => {
    setDiagCrumbs([...diagCrumbs, node.label]);
    if (node.children) setDiagStack([...diagStack, node.children]);
    else setDiagLeaf(node);
  };
  const diagBack = () => {
    if (diagLeaf) { setDiagLeaf(null); setDiagCrumbs(diagCrumbs.slice(0, -1)); return; }
    if (diagStack.length > 1) { setDiagStack(diagStack.slice(0, -1)); setDiagCrumbs(diagCrumbs.slice(0, -1)); }
    else goHome();
  };

  const uniqueVins = useCallback(() => {
    const set = new Set();
    [...notes, ...logs].forEach(x => { if (x.vin && x.vin.trim()) set.add(x.vin.trim().toUpperCase()); });
    return set;
  }, [notes, logs]);

  const checkVinLimit = (vin) => {
    const v = vin.trim().toUpperCase();
    if (!v || isPro) return true;
    const set = uniqueVins();
    if (set.has(v)) return true;
    if (set.size >= FREE_VIN_LIMIT) {
      Alert.alert(
        'Limit wersji Free',
        `W wersji darmowej możesz śledzić maks. ${FREE_VIN_LIMIT} pojazdy. Przejdź na PRO, żeby dodawać kolejne bez limitu.`,
        [{ text: 'Anuluj' }, { text: 'Zobacz PRO', onPress: () => setView('pro') }]
      );
      return false;
    }
    return true;
  };

  const upgradeToPro = async () => {
    setIsPro(true); await save('naprawnik_pro', [true]);
    Alert.alert('Gotowe!', 'Konto PRO aktywne (tryb testowy — prawdziwe płatności podłączymy po konfiguracji RevenueCat).');
  };
  const downgradeToFree = async () => { setIsPro(false); await save('naprawnik_pro', [false]); };

  const addNote = async () => {
    if (!noteText.trim()) return;
    if (!checkVinLimit(noteVin)) return;
    const n = [...notes, { vin: noteVin.trim(), text: noteText.trim(), date: new Date().toLocaleString('pl-PL') }];
    setNotes(n); await save('naprawnik_notes', n); setNoteText(''); setNoteVin('');
  };
  const addLog = async () => {
    if (!logDesc.trim()) return;
    if (!checkVinLimit(logVin)) return;
    const l = [...logs, { vin: logVin.trim(), desc: logDesc.trim(), date: new Date().toLocaleString('pl-PL') }];
    setLogs(l); await save('naprawnik_log', l); setLogDesc(''); setLogVin('');
  };
  const addShop = async (name, tier, price) => {
    const l = [...shop, { name, tier, price }];
    setShop(l); await save('naprawnik_shop', l);
  };
  const clearShop = async () => { setShop([]); await save('naprawnik_shop', []); };

  const submitSolution = async () => {
    if (!submitText.trim()) return;
    const entry = {
      path: diagCrumbs.join(' › '),
      text: submitText.trim(),
      name: submitName.trim() || 'Anonim',
      status: 'pending',
      date: new Date().toLocaleString('pl-PL'),
    };
    const s2 = [...submissions, entry];
    setSubmissions(s2); await save('naprawnik_submissions', s2);
    const p = points + 5;
    setPoints(p); await save('naprawnik_points', [p]);
    Alert.alert('Wysłano!', 'Zgłoszenie czeka na zatwierdzenie. Dostałeś +5 pkt za aktywność.');
    setSubmitText(''); setSubmitName('');
    goHome();
  };

  const addReminder = async () => {
    if (!remDesc.trim() || !remDate.trim()) return;
    const r = [...reminders, { vin: remVin.trim(), desc: remDesc.trim(), date: remDate.trim() }];
    setReminders(r); await save('naprawnik_reminders', r); setRemDesc(''); setRemVin(''); setRemDate('');
  };
  const toggleCheck = async (i) => {
    const d = checkDone.includes(i) ? checkDone.filter(x => x !== i) : [...checkDone, i];
    setCheckDone(d); await save('naprawnik_checklist_done', d);
  };
  const resetChecklist = async () => { setCheckDone([]); await save('naprawnik_checklist_done', []); };
  const startDiagFlow = (id) => { const f=DIAG_FLOWS[id]; if(!f) return; setDiagFlowId(id); setDiagStepId(null); setView('diagFlow'); setDiagStepId(f.steps[0].id || 0); };
  const currentDiagStep = () => { const f=DIAG_FLOWS[diagFlowId]; if(!f) return null; return f.steps.find(x => (x.id || 0) === diagStepId) || f.steps[0]; };
  const answerDiagFlow = async (answer) => { const f=DIAG_FLOWS[diagFlowId]; const st=currentDiagStep(); if(!f||!st) return; const next=st[answer]; if(!next) return; const n=f.steps.find(x=>(x.id||0)===next); if(n?.result){ const h=[...diagHistory,{flow:f.title,result:n.result,detail:n.detail,date:new Date().toLocaleString('pl-PL'),vehicleId:selectedVehicleId}]; setDiagHistory(h); await save('naprawnik_diag_history',h); setDiagStepId(next); } else setDiagStepId(next); };
  const resetDiagFlow = () => { setDiagFlowId(null); setDiagStepId(null); setView('diag'); };
  const addVehicle = async () => { const v={...vehicleForm,id:Date.now().toString(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; if(!v.brand.trim()&&!v.model.trim()&&!v.vin.trim()){Alert.alert('Brak danych','Podaj przynajmniej VIN, markę lub model.');return;} const a=[...vehicles,v]; setVehicles(a); await save('naprawnik_vehicles',a); setSelectedVehicleId(v.id); setVehicleForm({vin:'',brand:'',model:'',year:'',engine:'',mileage:'',mods:'',notes:''}); setView('vehicleDetail'); };
  const addRepair = async () => { if(!selectedVehicleId||!repairForm.repair.trim()){Alert.alert('Brak danych','Wpisz opis wykonanej naprawy.');return;} const r={...repairForm,id:Date.now().toString(),vehicleId:selectedVehicleId,date:new Date().toLocaleString('pl-PL')}; const a=[...repairs,r]; setRepairs(a); await save('naprawnik_repairs',a); setRepairForm({symptom:'',diagnosis:'',repair:'',parts:'',cost:'',mileage:'',notes:''}); };
  const deleteVehicle = async (id) => { const vs=vehicles.filter(v=>v.id!==id), rs=repairs.filter(r=>r.vehicleId!==id); setVehicles(vs); setRepairs(rs); await save('naprawnik_vehicles',vs); await save('naprawnik_repairs',rs); setSelectedVehicleId(null); setView('vehicles'); };
  const exportData = async () => {
    const payload = { notes, logs, shop, reminders, submissions, points, vehicles, repairs, diagHistory, exportDate: new Date().toISOString() };
    try {
      await Share.share({ message: JSON.stringify(payload, null, 2), title: 'Naprawnik — backup danych' });
    } catch (e) { Alert.alert('Błąd', 'Nie udało się wyeksportować danych.'); }
return (<>    };
      <Btn onPress={() => setView('models')}>🔧 Profile konkretnych silników</Btn> </>);
      <Btn onPress={() => setView('multimeter')}>📏 Procedury multimetru</Btn>
  };

  // ---------- WIDOKI ----------
  const renderHome = () => (
    <ScrollView>
      <View style={s.alert}>
        <Text style={s.alertTitle}>⚠️ SYSTEM GOTOWY ⚠️</Text>
        <Text style={s.alertSub}>Tryb offline aktywny</Text>
      </View>
      <View style={s.grid2}>
        <Tile icon="🔧" label="Diagnostyka" onPress={openDiag} />
        <Tile icon="🔩" label="Dwusuw 2T" onPress={() => { setEngineType('2T'); setView('engine'); }} />
        <Tile icon="⚙️" label="Czterosuw 4T" onPress={() => { setEngineType('4T'); setView('engine'); }} />
        <Tile icon="🔄" label="CVT (Skutery)" onPress={() => { setEngineType('CVT'); setView('engine'); }} />
        <Tile icon="⚡" label="Elektryka" onPress={() => setView('electric')} />
        <Tile icon="🧪" label="Kalkulator 2T" onPress={() => setView('mix')} />
      </View>
      <Btn onPress={() => setView('vehicles')}>🏍️ Kartoteka pojazdów / historia napraw</Btn>
      <Btn onPress={() => setView('diagFlow')}>🧪 Diagnostyka krok po kroku</Btn>
      <Btn onPress={() => setView('reminders')}>⏰ Harmonogram przeglądów</Btn>
      <Btn onPress={() => setView('checklist')}>✅ Checklista przeglądu</Btn>
      <Btn onPress={() => setView('log')}>🛡️ Czarna Skrzynka (VIN Log)</Btn>
      <Btn onPress={() => setView('notes')}>📝 Notatnik Mechanika</Btn>
      <Btn onPress={() => setView('shop')}>💰 Cennik 3-Tier / Lista zakupów</Btn>
      <Btn onPress={() => setView('submit')}>💡 Zgłoś własne rozwiązanie</Btn>
      <Btn onPress={() => setView('rewards')}>{`🏆 Punkty i nagrody (${points})`}</Btn>
    </ScrollView>
  );

  const Tile = ({ icon, label, onPress }) => (
    <TouchableOpacity style={s.tile} onPress={onPress}>
      <Text style={s.tileIcon}>{icon}</Text><Text style={s.tileLabel}>{label}</Text>
    </TouchableOpacity>
  );
  const BackBtn = ({ onPress }) => (
    <TouchableOpacity onPress={onPress}><Text style={s.backBtn}>← Wstecz</Text></TouchableOpacity>
  );
  const Crumbs = ({ items }) => <Text style={s.crumbs}>{items.join(' › ')}</Text>;


  const renderDiag = () => {
    if (diagLeaf) {
      return (
        <ScrollView>
          <BackBtn onPress={diagBack} /><Crumbs items={diagCrumbs} />
          <Card title="Prawdopodobne przyczyny">
            {diagLeaf.causes.map((c, i) => <Entry key={i} sub={`• ${c}`} />)}
          </Card>
          <Btn onPress={openDiag}>🔁 Zacznij od nowa</Btn>
          <Btn onPress={() => setView('submit')}>💡 Zaproponuj inną przyczynę</Btn>
        </ScrollView>
      );
    }
    const level = diagStack[diagStack.length - 1];
    return (
      <ScrollView>
        <BackBtn onPress={diagBack} /><Crumbs items={diagCrumbs} />
        {level.map((n, i) => <Btn key={i} onPress={() => diagSelect(n)}>{n.label} →</Btn>)}
      </ScrollView>
    );
  };

  const typeName = (t) => (t === '2T' ? 'Dwusuw 2T' : t === '4T' ? 'Czterosuw 4T' : 'CVT (Skutery)');

  const renderDiagFlow = () => { const f=DIAG_FLOWS[diagFlowId]; const st=currentDiagStep(); if(!f||!st) return <ScrollView><BackBtn onPress={resetDiagFlow}/><Card title="Diagnostyka krok po kroku">{Object.entries(DIAG_FLOWS).map(([id,x])=><Btn key={id} onPress={()=>startDiagFlow(id)}>{x.title} →</Btn>)}</Card></ScrollView>; if(st.result) return <ScrollView><BackBtn onPress={resetDiagFlow}/><Card title="Wynik diagnozy"><Text style={s.result}>{st.result}</Text><Text style={s.entryBody}>{st.detail}</Text><Text style={s.dimSmall}>Wynik jest wskazówką diagnostyczną, nie potwierdzeniem uszkodzenia części.</Text></Card><Btn onPress={()=>setView(selectedVehicleId?'vehicleDetail':'vehicles')}>🧾 Zapisz / przejdź do historii</Btn><Btn onPress={resetDiagFlow}>🔁 Nowa diagnoza</Btn></ScrollView>; return <ScrollView><BackBtn onPress={resetDiagFlow}/><Card title={f.title}><Text style={s.h2}>{st.q}</Text>{st.expected&&<Text style={s.dim}>Kontrola: {st.expected}</Text>}{st.warn&&<Text style={s.warning}>⚠️ {st.warn}</Text>}<Btn onPress={()=>answerDiagFlow('yes')}>TAK / wynik prawidłowy</Btn><Btn onPress={()=>answerDiagFlow('no')}>NIE / wynik nieprawidłowy</Btn><Btn onPress={()=>setDiagStepId(f.steps.find(x=>x.result)?.id || 0)}>Nie wiem — zakończ test</Btn></Card></ScrollView>; };

  const renderVehicles = () => <ScrollView><Card title="Kartoteka pojazdów"><TextInput style={s.input} placeholder="VIN" placeholderTextColor="#666" value={vehicleForm.vin} onChangeText={v=>setVehicleForm({...vehicleForm,vin:v})}/><TextInput style={s.input} placeholder="Marka" placeholderTextColor="#666" value={vehicleForm.brand} onChangeText={v=>setVehicleForm({...vehicleForm,brand:v})}/><TextInput style={s.input} placeholder="Model" placeholderTextColor="#666" value={vehicleForm.model} onChangeText={v=>setVehicleForm({...vehicleForm,model:v})}/><TextInput style={s.input} placeholder="Rok" placeholderTextColor="#666" value={vehicleForm.year} onChangeText={v=>setVehicleForm({...vehicleForm,year:v})}/><TextInput style={s.input} placeholder="Silnik" placeholderTextColor="#666" value={vehicleForm.engine} onChangeText={v=>setVehicleForm({...vehicleForm,engine:v})}/><TextInput style={s.input} placeholder="Przebieg" placeholderTextColor="#666" value={vehicleForm.mileage} onChangeText={v=>setVehicleForm({...vehicleForm,mileage:v})}/><TextInput style={[s.input,s.textarea]} placeholder="Modyfikacje / uwagi" placeholderTextColor="#666" value={vehicleForm.mods} onChangeText={v=>setVehicleForm({...vehicleForm,mods:v})} multiline/><Btn onPress={addVehicle}>+ Dodaj pojazd</Btn></Card>{vehicles.map(v=><TouchableOpacity key={v.id} style={s.entry} onPress={()=>{setSelectedVehicleId(v.id);setView('vehicleDetail')}}><Text style={s.entryTitle}>{v.brand||'Pojazd'} {v.model}</Text><Text style={s.entrySub}>{v.vin||'Bez VIN'} · {v.year||'rok —'} · {v.engine||'silnik —'}</Text></TouchableOpacity>)}</ScrollView>;

  const renderVehicleDetail = () => { const v=vehicles.find(x=>x.id===selectedVehicleId); const rs=repairs.filter(x=>x.vehicleId===selectedVehicleId); if(!v)return <ScrollView><Btn onPress={()=>setView('vehicles')}>Wróć</Btn></ScrollView>; return <ScrollView><BackBtn onPress={()=>setView('vehicles')}/><Card title={`${v.brand||''} ${v.model||'Pojazd'}`}><Text style={s.entrySub}>VIN: {v.vin||'—'}</Text><Text style={s.entrySub}>Rok: {v.year||'—'} · Silnik: {v.engine||'—'} · Przebieg: {v.mileage||'—'}</Text><Text style={s.entryBody}>{v.mods||'Brak modyfikacji / uwag.'}</Text><Btn onPress={()=>setView('diagFlow')}>🧪 Diagnozuj ten pojazd</Btn></Card><Card title="Dodaj naprawę"><TextInput style={s.input} placeholder="Objaw" placeholderTextColor="#666" value={repairForm.symptom} onChangeText={x=>setRepairForm({...repairForm,symptom:x})}/><TextInput style={s.input} placeholder="Diagnoza" placeholderTextColor="#666" value={repairForm.diagnosis} onChangeText={x=>setRepairForm({...repairForm,diagnosis:x})}/><TextInput style={[s.input,s.textarea]} placeholder="Wykonana naprawa" placeholderTextColor="#666" value={repairForm.repair} onChangeText={x=>setRepairForm({...repairForm,repair:x})} multiline/><TextInput style={s.input} placeholder="Części użyte" placeholderTextColor="#666" value={repairForm.parts} onChangeText={x=>setRepairForm({...repairForm,parts:x})}/><TextInput style={s.input} placeholder="Koszt (zł)" placeholderTextColor="#666" keyboardType="decimal-pad" value={repairForm.cost} onChangeText={x=>setRepairForm({...repairForm,cost:x})}/><TextInput style={s.input} placeholder="Przebieg przy naprawie" placeholderTextColor="#666" keyboardType="numeric" value={repairForm.mileage} onChangeText={x=>setRepairForm({...repairForm,mileage:x})}/><TextInput style={[s.input,s.textarea]} placeholder="Dodatkowe uwagi" placeholderTextColor="#666" value={repairForm.notes} onChangeText={x=>setRepairForm({...repairForm,notes:x})} multiline/><Btn onPress={addRepair}>+ Zapisz naprawę</Btn></Card><Card title={`Historia napraw (${rs.length})`}>{rs.length?rs.slice().reverse().map(r=><Entry key={r.id} title={r.repair} sub={`${r.date} · ${r.cost||'koszt —'}`}><Text style={s.entryBody}>Objaw: {r.symptom||'—'}{r.diagnosis?`\nDiagnoza: ${r.diagnosis}`:''}{r.parts?`\nCzęści: ${r.parts}`:''}{r.mileage?`\nPrzebieg: ${r.mileage}`:''}{r.notes?`\nUwagi: ${r.notes}`:''}</Text></Entry>):<Text style={s.empty}>Brak napraw</Text>}</Card><Btn onPress={()=>Alert.alert('Usuń pojazd','Usunąć kartotekę i historię napraw?',[{text:'Anuluj'},{text:'Usuń',onPress:()=>deleteVehicle(v.id)}])}>🗑️ Usuń pojazd</Btn></ScrollView>; };


  const renderModels = () => (
    <ScrollView>
      <BackBtn onPress={goHome} />
      <Card title="Profile silników / jednostek">
        <Text style={s.dim}>Parametry momentów są orientacyjne. Dla konkretnego modelu zawsze sprawdź DTR producenta.</Text>
        {ENGINE_PROFILES.map(p => <Btn key={p.id} onPress={()=>{setEngineProfileId(p.id);setView('engineProfile')}}>{p.name} · {p.family}</Btn>)}
      </Card>
    </ScrollView>
  );

  const renderEngineProfile = () => {
    const p = ENGINE_PROFILES.find(x=>x.id===engineProfileId) || ENGINE_PROFILES[0];
    return <ScrollView><BackBtn onPress={()=>setView('models')}/><Card title={p.name}><Text style={s.entrySub}>{p.family}</Text><Text style={s.entryBody}>{p.info}</Text></Card><Card title="Kontrola / diagnostyka">{p.checks.map((x,i)=><Entry key={i} sub={`• ${x}`}/>)}</Card><Card title="Momenty orientacyjne">{p.torque.map(([a,b],i)=><View key={i} style={s.tableRow}><Text style={s.tableCell}>{a}</Text><Text style={s.tableCellRight}>{b}</Text></View>)}</Card><Text style={s.dim}>⚠️ Wartości orientacyjne. Wersja silnika, rocznik i producent pojazdu mogą zmieniać specyfikację.</Text></ScrollView>;
  };

  const renderMultimeter = () => {
    const p = meterProcedure ? MULTIMETER_PROCEDURES.find(x=>x.title===meterProcedure) : null;
    if (p) return <ScrollView><BackBtn onPress={()=>setMeterProcedure(null)}/><Card title={p.title}><Text style={s.warning}>⚠️ Odłącz zasilanie tam, gdzie wymaga tego procedura. Nie mierz rezystancji w obwodzie pod napięciem.</Text>{p.steps.map((x,i)=><Entry key={i} title={`${i+1}. ${x}`}/>)}</Card><Card title="Wynik / interpretacja"><Text style={s.entryBody}>{p.expected}</Text></Card></ScrollView>;
    return <ScrollView><BackBtn onPress={goHome}/><Card title="Multimetr — procedury warsztatowe"><Text style={s.dim}>Dobieraj zakres i sposób pomiaru do DTR konkretnego pojazdu.</Text>{MULTIMETER_PROCEDURES.map((x,i)=><Btn key={i} onPress={()=>setMeterProcedure(x.title)}>{x.title}</Btn>)}</Card></ScrollView>;
  };

  const renderEngine = () => (
    <ScrollView>
      <BackBtn onPress={goHome} />
      <Card title={typeName(engineType)}>
        <Btn onPress={() => setView('torque')}>📐 Momenty dokręcania</Btn>
        <Btn onPress={() => setView('wiring')}>⚡ Instalacja elektryczna</Btn>
      </Card>
    </ScrollView>
  );

  const renderTorque = () => (
    <ScrollView>
      <BackBtn onPress={() => setView('engine')} />
      <Card title={`Momenty dokręcania — ${typeName(engineType)}`}>
        {TORQUE[engineType].map(([p, n], i) => (
          <View key={i} style={s.tableRow}><Text style={s.tableCell}>{p}</Text><Text style={s.tableCellRight}>{n} Nm</Text></View>
        ))}
      </Card>
      <Text style={s.dim}>Wartości orientacyjne — zawsze zweryfikuj z DTR producenta.</Text>
    </ScrollView>
  );

  const renderWiring = () => {
    const w = WIRING[engineType];
    return (
      <ScrollView>
        <BackBtn onPress={() => setView('engine')} />
        <Card title={`Instalacja elektryczna — ${typeName(engineType)}`}>
          {w.obwody.map(([n, d], i) => <Entry key={i} title={n} sub={d} />)}
        </Card>
        <Card title="Typowe kolory przewodów">
          {w.kolory.map(([c, f], i) => (
            <View key={i} style={s.tableRow}><Text style={s.tableCell}>{c}</Text><Text style={s.tableCellRight}>{f}</Text></View>
          ))}
        </Card>
        <Text style={s.dim}>Kolory i obwody orientacyjne — zawsze zweryfikuj ze schematem z DTR pojazdu.</Text>
      </ScrollView>
    );
  };

  const renderElectric = () => (
    <ScrollView>
      <BackBtn onPress={goHome} />
      <Card title="Elektryka — checklista">
        {ELECTRIC_CHECKS.map((t, i) => <Entry key={i} sub={`• ${t}`} />)}
      </Card>
    </ScrollView>
  );

  const renderLog = () => (
    <ScrollView>
      <BackBtn onPress={goHome} />
      <Card title="Czarna Skrzynka">
        <TextInput style={s.input} placeholder="Numer VIN" placeholderTextColor="#666" value={logVin} onChangeText={setLogVin} />
        <TextInput style={[s.input, s.textarea]} placeholder="Opis wykonanej operacji" placeholderTextColor="#666" value={logDesc} onChangeText={setLogDesc} multiline />
        <Btn onPress={addLog}>+ Zapisz wpis</Btn>
      </Card>
      <Card title={`Historia (${logs.length})`}>
        {logs.length === 0 ? <Text style={s.empty}>Brak wpisów</Text> :
          logs.slice().reverse().map((l, i) => <Entry key={i} title={`VIN: ${l.vin || '—'}`} sub={l.date}><Text style={s.entryBody}>{l.desc}</Text></Entry>)}
      </Card>
    </ScrollView>
  );

  const renderNotes = () => (
    <ScrollView>
      <BackBtn onPress={goHome} />
      <Card title="Notatnik Mechanika">
        <TextInput style={s.input} placeholder="VIN (opcjonalnie)" placeholderTextColor="#666" value={noteVin} onChangeText={setNoteVin} />
        <TextInput style={[s.input, s.textarea]} placeholder="Notatka..." placeholderTextColor="#666" value={noteText} onChangeText={setNoteText} multiline />
        <Btn onPress={addNote}>+ Dodaj notatkę</Btn>
      </Card>
      <Card title={`Zapisane (${notes.length})`}>
        {notes.length === 0 ? <Text style={s.empty}>Brak notatek</Text> :
          notes.slice().reverse().map((n, i) => <Entry key={i} title={n.vin || 'Ogólna'} sub={n.date}><Text style={s.entryBody}>{n.text}</Text></Entry>)}
      </Card>
    </ScrollView>
  );

  const renderShop = () => (
    <ScrollView>
      <BackBtn onPress={goHome} />
      <Card title="Cennik 3-Tier">
        {PARTS_PRICES.map(([name, eco, turbo, prem], i) => (
          <View key={i} style={s.tierRow}>
            <Text style={s.tierName}>{name}</Text>
            <View style={s.tierPrices}>
              <TouchableOpacity onPress={() => addShop(name, 'Economy', eco)}><Text style={s.tierEco}>Eco {eco}zł</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => addShop(name, 'Turbo Diesel', turbo)}><Text style={s.tierTurbo}>TD {turbo}zł</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => addShop(name, 'Premium', prem)}><Text style={s.tierPrem}>Prem {prem}zł</Text></TouchableOpacity>
            </View>
          </View>
        ))}
      </Card>
      <Card title={`Lista zakupowa (${shop.length})`}>
        {shop.length === 0 ? <Text style={s.empty}>Pusta lista</Text> :
          shop.slice().reverse().map((i2, i) => <Entry key={i} sub={`${i2.name} — ${i2.tier} (${i2.price}zł)`} />)}
        {shop.length > 0 && <Btn onPress={clearShop}>Wyczyść listę</Btn>}
      </Card>
    </ScrollView>
  );

  const renderSearch = () => {
    const q = query.trim().toLowerCase();
    const nRes = q ? notes.filter(n => (n.vin || '').toLowerCase().includes(q) || n.text.toLowerCase().includes(q)) : [];
    const lRes = q ? logs.filter(l => (l.vin || '').toLowerCase().includes(q) || l.desc.toLowerCase().includes(q)) : [];
    return (
      <ScrollView>
        <Card title="Szukaj po VIN / słowie kluczowym">
          <TextInput style={s.input} placeholder="Wpisz VIN lub frazę..." placeholderTextColor="#666" value={query} onChangeText={setQuery} />
          {q !== '' && nRes.length === 0 && lRes.length === 0 && <Text style={s.empty}>Brak wyników</Text>}
          {nRes.map((n, i) => <Entry key={'n' + i} title={`Notatka · ${n.vin || '—'}`} sub={n.date}><Text style={s.entryBody}>{n.text}</Text></Entry>)}
          {lRes.map((l, i) => <Entry key={'l' + i} title={`Log · ${l.vin || '—'}`} sub={l.date}><Text style={s.entryBody}>{l.desc}</Text></Entry>)}
        </Card>
      </ScrollView>
    );
  };

  const renderMix = () => {
    const liters = parseFloat(mixLiters.replace(',', '.'));
    const ml = liters > 0 ? Math.round((liters * 1000) / mixRatio) : null;
    return (
      <ScrollView>
        <BackBtn onPress={goHome} />
        <Card title="Kalkulator mieszanki 2T">
          <TextInput style={s.input} placeholder="Ilość paliwa (litry)" placeholderTextColor="#666" keyboardType="decimal-pad" value={mixLiters} onChangeText={setMixLiters} />
          <View style={s.tierPrices}>
            {[25, 32, 40, 50, 100].map(r => (
              <TouchableOpacity key={r} onPress={() => setMixRatio(r)}>
                <Text style={mixRatio === r ? s.tierTurbo : s.tierEco}>1:{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[s.h2, { textAlign: 'center', marginTop: 12 }]}>
            {ml ? `${ml} ml oleju na ${mixLiters} l benzyny` : 'Wpisz ilość paliwa'}
          </Text>
        </Card>
      </ScrollView>
    );
  };

  const renderReminders = () => {
    const today = new Date().toISOString().slice(0, 10);
    return (
      <ScrollView>
        <BackBtn onPress={goHome} />
        <Card title="Nowe przypomnienie">
          <TextInput style={s.input} placeholder="VIN (opcjonalnie)" placeholderTextColor="#666" value={remVin} onChangeText={setRemVin} />
          <TextInput style={s.input} placeholder="Co zrobić (np. wymiana oleju)" placeholderTextColor="#666" value={remDesc} onChangeText={setRemDesc} />
          <TextInput style={s.input} placeholder="Termin (RRRR-MM-DD)" placeholderTextColor="#666" value={remDate} onChangeText={setRemDate} />
          <Btn onPress={addReminder}>+ Dodaj przypomnienie</Btn>
        </Card>
        <Card title={`Harmonogram (${reminders.length})`}>
          {reminders.length === 0 ? <Text style={s.empty}>Brak przypomnień</Text> :
            reminders.slice().sort((a, b) => a.date.localeCompare(b.date)).map((r, i) => {
              const overdue = r.date < today;
              return <Entry key={i} title={r.desc} sub={`${r.vin || '—'} · termin: ${r.date}${overdue ? ' ⚠️ PO TERMINIE' : ''}`} />;
            })}
        </Card>
      </ScrollView>
    );
  };

  const renderChecklistView = () => (
    <ScrollView>
      <BackBtn onPress={goHome} />
      <Card title="Checklista przeglądu okresowego">
        {CHECKLIST_ITEMS.map((t, i) => {
          const isDone = checkDone.includes(i);
          return (
            <TouchableOpacity key={i} onPress={() => toggleCheck(i)} style={s.entry}>
              <Text style={isDone ? s.rewardReady : s.entrySub}>{isDone ? '☑ ' : '☐ '}{t}</Text>
            </TouchableOpacity>
          );
        })}
      </Card>
      <Btn onPress={resetChecklist}>🔁 Wyczyść / nowy przegląd</Btn>
    </ScrollView>
  );

  const renderSubmit = () => (
    <ScrollView>
      <BackBtn onPress={goHome} />
      <Card title="Zgłoś własne rozwiązanie">
        <Text style={s.dim}>Kontekst: {diagCrumbs.join(' › ')}</Text>
        <TextInput style={s.input} placeholder="Twój nick (opcjonalnie)" placeholderTextColor="#666" value={submitName} onChangeText={setSubmitName} />
        <TextInput style={[s.input, s.textarea]} placeholder="Opisz przyczynę/rozwiązanie, które sprawdziło się u Ciebie..." placeholderTextColor="#666" value={submitText} onChangeText={setSubmitText} multiline />
        <Btn onPress={submitSolution}>📤 Wyślij do zatwierdzenia (+5 pkt)</Btn>
        <Text style={s.dimSmall}>Zgłoszenie czeka na akceptację właściciela. Po zatwierdzeniu trafi do wspólnej bazy diagnostycznej.</Text>
      </Card>
    </ScrollView>
  );

  const renderRewards = () => (
    <ScrollView>
      <BackBtn onPress={goHome} />
      <Card title={`Twoje punkty: ${points}`}>
        {REWARDS.map((r, i) => (
          <Entry key={i} title={`${r.pts} pkt`} sub={r.label}>
            <Text style={points >= r.pts ? s.rewardReady : s.rewardLocked}>{points >= r.pts ? '✅ Odblokowana' : `Brakuje ${r.pts - points} pkt`}</Text>
          </Entry>
        ))}
      </Card>
      <Card title={`Twoje zgłoszenia (${submissions.length})`}>
        {submissions.length === 0 ? <Text style={s.empty}>Brak zgłoszeń</Text> :
          submissions.slice().reverse().map((sub, i) => (
            <Entry key={i} title={sub.path} sub={`${sub.status === 'pending' ? '⏳ Oczekuje' : sub.status} · ${sub.date}`}>
              <Text style={s.entryBody}>{sub.text}</Text>
            </Entry>
          ))}
      </Card>
    </ScrollView>
  );

  const renderPro = () => (
    <ScrollView>
      <BackBtn onPress={goHome} />
      <Card title={isPro ? '✅ Masz plan PRO' : 'Przejdź na PRO'}>
        {!isPro && <Text style={[s.h2, { textAlign: 'center', marginBottom: 10 }]}>{PRO_PRICE}</Text>}
        <View style={s.tableRow}><Text style={[s.tableCell, { fontWeight: 'bold' }]}>Funkcja</Text><Text style={[s.tableCell, { fontWeight: 'bold', textAlign: 'right' }]}>FREE / PRO</Text></View>
        {PLAN_FEATURES.map(([label, free, pro], i) => (
          <View key={i} style={s.tableRow}>
            <Text style={s.tableCell}>{label}</Text>
            <Text style={s.tableCellRight}>{typeof free === 'boolean' ? (free ? '✓' : '—') : free} / {typeof pro === 'boolean' ? (pro ? '✓' : '—') : pro}</Text>
          </View>
        ))}
        {!isPro
          ? <Btn onPress={() => Alert.alert('Przejść na PRO?', `${PRO_PRICE} — tryb testowy, bez realnej płatności (na razie).`, [{ text: 'Anuluj' }, { text: 'Aktywuj', onPress: upgradeToPro }])}>⭐ Przejdź na PRO</Btn>
          : <Btn onPress={() => Alert.alert('Wyłączyć PRO?', 'To tylko tryb testowy do sprawdzenia limitów Free.', [{ text: 'Anuluj' }, { text: 'Wyłącz', onPress: downgradeToFree }])}>Wyłącz PRO (test)</Btn>}
        <Text style={s.dimSmall}>Prawdziwe płatności w App Store / Google Play podłączymy po konfiguracji konta dewelopera i RevenueCat.</Text>
      </Card>
    </ScrollView>
  );

  const renderSettings = () => (
    <ScrollView>
      <Card title="Ustawienia">
        <Text style={s.dim}>Wersja 5.0 — warsztatowa kartoteka, diagnostyka krok po kroku i procedury pomiarowe offline.</Text>
        <Text style={s.dim}>Aktualny plan: {isPro ? 'PRO ⭐' : `Free (${uniqueVins().size}/${FREE_VIN_LIMIT} pojazdów)`}</Text>
        <Btn onPress={() => setView('pro')}>{isPro ? '⭐ Zarządzaj planem' : '⭐ Zobacz PRO'}</Btn>
        <Text style={s.dimSmall}>Konta, synchronizacja zgłoszeń i realne punkty zostaną podłączone po skonfigurowaniu backendu.</Text>
        <Btn onPress={exportData}>📤 Eksportuj / wyślij backup danych</Btn>
        <Btn onPress={() => Alert.alert('Uwaga', 'Na pewno usunąć wszystkie dane?', [
          { text: 'Anuluj' }, { text: 'Usuń', onPress: async () => {
            await AsyncStorage.multiRemove(['naprawnik_notes', 'naprawnik_log', 'naprawnik_shop', 'naprawnik_submissions', 'naprawnik_points', 'naprawnik_reminders', 'naprawnik_checklist_done', 'naprawnik_pro', 'naprawnik_vehicles', 'naprawnik_repairs', 'naprawnik_diag_history']);
            setNotes([]); setLogs([]); setShop([]); setSubmissions([]); setPoints(0); setReminders([]); setCheckDone([]); setVehicles([]); setRepairs([]); setDiagHistory([]); setIsPro(false);
          }},
        ])}>🗑️ Wyczyść wszystkie dane</Btn>
      </Card>
    </ScrollView>
  );

  const screens = {
    home: renderHome, diag: renderDiag, engine: renderEngine, electric: renderElectric,
    log: renderLog, notes: renderNotes, shop: renderShop, search: renderSearch,
    submit: renderSubmit, rewards: renderRewards, settings: renderSettings,
    mix: renderMix, reminders: renderReminders, checklist: renderChecklistView, diagFlow: renderDiagFlow, vehicles: renderVehicles, vehicleDetail: renderVehicleDetail, models: renderModels, engineProfile: renderEngineProfile, multimeter: renderMultimeter,
    torque: renderTorque, wiring: renderWiring, pro: renderPro,
  };
  const bottomNavKey = ['search', 'settings'].includes(view) ? view : 'home';

  return (
    <SafeAreaView style={s.safe}>
      <ExpoStatusBar style="light" />
      <View style={s.topbar}>
        <Text style={s.topbarText}>⚙️ NAPRAWNIK [OFFLINE]</Text>
        <Text style={s.topbarText}>{isPro ? '⭐ PRO' : 'FREE'}</Text>
      </View>
      <View style={s.screen}>{screens[view] ? screens[view]() : renderHome()}</View>
      <View style={s.nav}>
        <TouchableOpacity onPress={goHome}><Text style={bottomNavKey === 'home' ? s.navActive : s.navItem}>🏠 Home</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setView('search')}><Text style={bottomNavKey === 'search' ? s.navActive : s.navItem}>🔍 Szukaj</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setView('settings')}><Text style={bottomNavKey === 'settings' ? s.navActive : s.navItem}>⚙️ Ustawienia</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const C = { bg: '#0d0d0d', panel: '#161616', border: '#333', accent: '#ff9900', text: '#e0e0e0', dim: '#777' };
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  topbar: { backgroundColor: C.accent, flexDirection: 'row', justifyContent: 'space-between', padding: 10, margin: 8, borderRadius: 4 },
  topbarText: { color: '#000', fontWeight: 'bold', fontSize: 13 },
  screen: { flex: 1, paddingHorizontal: 8 },
  nav: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 10 },
  navItem: { color: '#888', fontSize: 11 },
  navActive: { color: C.accent, fontSize: 11, fontWeight: 'bold' },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 6, padding: 12, marginBottom: 10 },
  h2: { color: C.accent, fontSize: 13, fontWeight: 'bold', marginBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 6, textTransform: 'uppercase' },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 10 },
  tile: { width: '48%', backgroundColor: C.panel, borderWidth: 2, borderColor: C.border, borderRadius: 6, padding: 14, alignItems: 'center', marginBottom: 10 },
  tileIcon: { fontSize: 22, marginBottom: 5 },
  tileLabel: { fontSize: 11, fontWeight: 'bold', color: C.accent, textTransform: 'uppercase', textAlign: 'center' },
  btn: { backgroundColor: C.panel, borderWidth: 2, borderColor: C.border, borderRadius: 6, padding: 12, alignItems: 'center', marginBottom: 8 },
  btnText: { color: C.text, fontWeight: 'bold', fontSize: 12, textTransform: 'uppercase' },
  backBtn: { color: C.accent, marginBottom: 10, fontWeight: 'bold' },
  crumbs: { color: C.dim, fontSize: 11, marginBottom: 10 },
  entry: { borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 8 },
  entryTitle: { color: C.accent, fontWeight: 'bold', fontSize: 12 },
  entrySub: { color: C.text, fontSize: 12 },
  entryBody: { color: C.text, fontSize: 12, marginTop: 3 },
  empty: { color: C.dim, fontSize: 12, textAlign: 'center', paddingVertical: 14 },
  dim: { color: C.dim, fontSize: 11, marginBottom: 8 },
  dimSmall: { color: C.dim, fontSize: 10, marginTop: 6 },
  input: { backgroundColor: '#000', borderWidth: 1, borderColor: C.border, color: C.text, padding: 8, fontSize: 13, borderRadius: 4, marginBottom: 8 },
  textarea: { minHeight: 60, textAlignVertical: 'top' },
  tableRow: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 5 },
  tableCell: { color: C.text, fontSize: 12, flex: 1 },
  tableCellRight: { color: C.accent, fontSize: 12, fontWeight: 'bold' },
  tierRow: { borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 8 },
  tierName: { color: C.text, fontSize: 12, marginBottom: 6 },
  tierPrices: { flexDirection: 'row', justifyContent: 'space-between' },
  tierEco: { color: '#7fbf7f', borderWidth: 1, borderColor: C.border, padding: 4, borderRadius: 3, fontSize: 11 },
  tierTurbo: { color: C.accent, borderWidth: 1, borderColor: C.border, padding: 4, borderRadius: 3, fontSize: 11 },
  tierPrem: { color: '#ff6b6b', borderWidth: 1, borderColor: C.border, padding: 4, borderRadius: 3, fontSize: 11 },
  rewardReady: { color: '#7fbf7f', fontSize: 11, fontWeight: 'bold', marginTop: 3 },
  result: { color: C.accent, fontSize: 18, fontWeight: 'bold', marginBottom: 10 },
  warning: { color: '#ffcc66', fontSize: 12, marginBottom: 10 },
  rewardLocked: { color: C.dim, fontSize: 11, marginTop: 3 },
  alert: { borderWidth: 2, borderColor: C.accent, borderStyle: 'dashed', borderRadius: 4, padding: 8, alignItems: 'center', marginBottom: 10 },
  alertTitle: { color: C.accent, fontWeight: 'bold', fontSize: 11 },
  alertSub: { color: C.accent, fontSize: 11 },
});
