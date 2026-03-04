import React, { createContext, useContext, useState } from "react";

interface BalanceVisibilityContextType {
  balanceVisible: boolean;
  toggleBalance: () => void;
}

const BalanceVisibilityContext = createContext<BalanceVisibilityContextType>({
  balanceVisible: false,
  toggleBalance: () => {},
});

export function BalanceVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [balanceVisible, setBalanceVisible] = useState(false);
  return (
    <BalanceVisibilityContext.Provider value={{ balanceVisible, toggleBalance: () => setBalanceVisible(v => !v) }}>
      {children}
    </BalanceVisibilityContext.Provider>
  );
}

export function useBalanceVisibility() {
  return useContext(BalanceVisibilityContext);
}
