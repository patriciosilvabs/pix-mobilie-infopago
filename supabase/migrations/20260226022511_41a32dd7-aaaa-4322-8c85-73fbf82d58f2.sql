-- Allow admins to delete receipts
CREATE POLICY "Admins can delete receipts"
ON public.receipts FOR DELETE
TO authenticated
USING (
  is_admin(auth.uid())
  AND transaction_id IN (
    SELECT id FROM transactions
    WHERE company_id IN (SELECT get_user_companies(auth.uid()))
  )
);