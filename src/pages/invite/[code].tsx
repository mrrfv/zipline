import { GetServerSideProps } from 'next';
import prisma from 'lib/prisma';
import { useState } from 'react';
import { Button, Card, Center, Group, PasswordInput, Stepper, TextInput } from '@mantine/core';
import useFetch from 'hooks/useFetch';
import PasswordStrength from 'components/PasswordStrength';
import { useNotifications } from '@mantine/notifications';
import { CrossIcon, UserIcon } from 'components/icons';
import { useStoreDispatch } from 'lib/redux/store';
import { updateUser } from 'lib/redux/reducers/user';
import { useRouter } from 'next/router';

export default function Invite({ code }) {
  const [active, setActive] = useState(0);
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [password, setPassword] = useState('');
  const [verifyPassword, setVerifyPassword] = useState('');
  const [verifyPasswordError, setVerifyPasswordError] = useState('');
  const [strength, setStrength] = useState(0);

  const notif = useNotifications();
  const dispatch = useStoreDispatch();
  const router = useRouter();

  const nextStep = () => setActive((current) => (current < 3 ? current + 1 : current));
  const prevStep = () => setActive((current) => (current > 0 ? current - 1 : current));

  const checkUsername = async () => {
    setUsername(username.trim());

    setUsernameError('');

    const res = await useFetch('/api/users', 'POST', { code, username });
    if (res.error) {
      setUsernameError('A user with that username already exists');
    } else {
      setUsernameError('');
    }
  };

  const checkPassword = () => {
    setVerifyPasswordError('');
    setPassword(password.trim());
    setVerifyPassword(verifyPassword.trim());

    if (password.trim() !== verifyPassword.trim()) {
      setVerifyPasswordError('Passwords do not match');
    }
  };

  const createUser = async () => {
    const res = await useFetch('/api/auth/create', 'POST', { code, username, password });
    if (res.error) {
      notif.showNotification({
        title: 'Error while creating user',
        message: res.error,
        color: 'red',
        icon: <CrossIcon />,
      });
    } else {
      notif.showNotification({
        title: 'User created',
        message: 'You will be logged in shortly...',
        color: 'green',
        icon: <UserIcon />,
      });

      dispatch(updateUser(null));
      await useFetch('/api/auth/logout');
      await useFetch('/api/auth/login', 'POST', {
        username, password,
      });

      router.push('/dashboard');
            
    }
  };

  return (
    <>
      <Center sx={{ height: '100vh' }}>
        <Card>
          <Stepper active={active} onStepClick={setActive} breakpoint='sm'>
            <Stepper.Step label='Welcome' description='Choose a username' allowStepSelect={active > 0}>
              <TextInput
                label='Username'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                error={usernameError}
                onBlur={() => checkUsername()}
              />
              <Group position='center' mt='xl'>
                {/* <Button variant='default' onClick={prevStep}>Back</Button> */}
                <Button disabled={usernameError !== '' || username == ''} onClick={nextStep}>Continue</Button>
              </Group>
            </Stepper.Step>
            <Stepper.Step label='Choose a password' allowStepSelect={active > 1 && usernameError === ''}>
              <PasswordStrength value={password} setValue={setPassword} setStrength={setStrength} />
              <Group position='center' mt='xl'>
                <Button variant='default' onClick={prevStep}>Back</Button>
                <Button disabled={strength !== 100} onClick={nextStep}>Continue</Button>
              </Group>
            </Stepper.Step>
            <Stepper.Step label='Verify your password' allowStepSelect={active > 2}>
              <PasswordInput
                label='Verify password'
                value={verifyPassword}
                onChange={(e) => setVerifyPassword(e.target.value)}
                error={verifyPasswordError}
                onBlur={() => checkPassword()}
              />
              <Group position='center' mt='xl'>
                <Button variant='default' onClick={prevStep}>Back</Button>
                <Button disabled={verifyPasswordError !== '' || verifyPassword == ''} onClick={nextStep}>Continue</Button>
              </Group>
            </Stepper.Step>
            <Stepper.Completed>
              <Group position='center' mt='xl'>
                <Button variant='default' onClick={() => setActive(0)}>Go back</Button>
                <Button onClick={() => createUser()}>Finish setup</Button>
              </Group>
            </Stepper.Completed>
          </Stepper>
        </Card>
      </Center>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async context => {
  const { code } = context.query as { code: string };

  const invite = await prisma.invite.findUnique({
    where: {
      code,
    },
  });

  if (!invite) return { notFound: true };
  if (invite.used) return { notFound: true };

  if (invite.expires_at && invite.expires_at < new Date()) {
    await prisma.invite.delete({
      where: {
        code,
      },
    });

    return { notFound: true };
  };

  return { props: { code: invite.code } };
};