import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the main heading', () => {
  render(<App />);
  const heading = screen.getByText(/15/i);
  expect(heading).toBeInTheDocument();
});
